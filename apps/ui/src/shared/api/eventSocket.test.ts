import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type * as EventSocketModule from './eventSocket'

/**
 * NO `mock.module` here, deliberately.
 *
 * This file used to replace `@/shared/lib/desktop` wholesale with
 * `{ isDesktop: false, getDesktopApiPort: () => null }`. Bun's `mock.module` is
 * PROCESS-global and never unwound, so every later test file in the same run saw a
 * `desktop` module with those two exports and nothing else. It survived only on file
 * ordering, and adding one unrelated UI test was enough to tip it over:
 * `useRealtimeConnection.dom.test.tsx` failed with `undefined is not an object
 * (evaluating 'socket.open')` in the full suite while passing on its own, because a
 * forced `isDesktop: false` changed which origin `eventSocket` resolved and no socket
 * was ever constructed.
 *
 * The mock was also unnecessary: with no `__LOCALIX_DESKTOP` / `__TAURI_INTERNALS__`
 * on `window`, the real module already reports exactly that. All 16 tests here pass
 * without it.
 */
import type { AgentStreamEvent } from './contracts'

const NativeWebSocket = globalThis.WebSocket

let eventSocketModule: typeof EventSocketModule

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(text: string): void {
    this.sent.push(text)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  close(): void {
    // A real browser never dispatches `onclose` synchronously from `close()` — the
    // socket transitions to CLOSED and the close event is delivered on a LATER task.
    // Modelling that faithfully is what surfaces the stale-socket race: a `release()`
    // that closes the socket, followed immediately by a `retain()` that opens a new
    // one, leaves the old socket's `onclose` to fire only afterwards, by which point
    // the module already tracks the newer socket.
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    queueMicrotask(() => this.onclose?.())
  }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('eventSocket', () => {
  beforeEach(async () => {
    eventSocketModule = await import('./eventSocket')
    // Establish the singleton's state, do not inherit it. Resetting only in `afterEach`
    // protects the NEXT file; this one still met an already-open socket left by another
    // suite, so `connect()` took its `if (socket) return` path and no FakeWebSocket was
    // ever constructed (`FakeWebSocket.instances[0]` undefined).
    eventSocketModule.resetEventSocketForTests()
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    eventSocketModule.resetEventSocketForTests()
    FakeWebSocket.instances = []
    globalThis.WebSocket = NativeWebSocket
  })

  it('identifies the realtime connection as a workbench surface', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})

    expect(new URL(FakeWebSocket.instances[0].url).searchParams.get('surface')).toBe('workbench')

    unsubscribe()
  })

  it('does not flush queued RPC frames after their requests were rejected on close', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})
    const request = eventSocketModule.eventSocket.request({
      t: 'send',
      sessionId: 's1',
      prompt: 'hello',
    })
    expect(eventSocketModule.getEventSocketDebugStateForTests()).toEqual({
      refCount: 2,
      pendingRequests: 1,
      outbound: 1,
    })

    FakeWebSocket.instances[0].close()
    expect(request).rejects.toMatchObject({ code: 'ws_closed' })
    expect(eventSocketModule.getEventSocketDebugStateForTests()).toEqual({
      refCount: 1,
      pendingRequests: 0,
      outbound: 0,
    })

    expect(eventSocketModule.runScheduledReconnectForTests()).toBeTrue()
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1].open()
    expect(FakeWebSocket.instances[1].sent).toEqual([])

    unsubscribe()
  })

  it('observes RPC lifecycle with correlation and allowlisted metadata only', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: EventSocketModule.RpcRequestEvent[] = []
    const off = eventSocketModule.eventSocket.onRequestEvent((event) => seen.push(event))
    const request = eventSocketModule.eventSocket.request({
      t: 'send',
      sessionId: 's1',
      prompt: 'must never enter event history',
    })
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.onmessage?.({ data: 'r\n{"id":"q1","ok":true,"result":{"ok":true}}' })

    expect(await request).toEqual({ ok: true })
    expect(seen.map(({ phase }) => phase)).toEqual(['started', 'succeeded'])
    expect(seen[0]).toMatchObject({
      traceId: 'q1',
      operation: 'send',
      attributes: { sessionId: 's1' },
    })
    expect(seen[0]?.attributes).not.toHaveProperty('prompt')
    off()
  })

  it('time-slices a large session burst without dropping or reordering frames', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const total = eventSocketModule.SESSION_FRAMES_PER_SLICE + 3
    const seen: number[] = []
    let resolveBurst!: () => void
    const burst = new Promise<void>((resolve) => {
      resolveBurst = resolve
    })
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) => {
      seen.push((event as unknown as { index: number }).index)
      if (seen.length === total) resolveBurst()
    })
    const ws = FakeWebSocket.instances[0]
    ws.open()
    for (let index = 0; index < total; index++) {
      ws.onmessage?.({
        data: `s\napi-boot-a:${index + 1}\nsess-a\n${JSON.stringify({ type: 'run.started', index })}`,
      })
    }

    expect(seen.length).toBeLessThan(total)
    await burst
    expect(seen).toEqual(Array.from({ length: total }, (_, index) => index))
    unsubscribe()
  })

  it('applies and resumes from the namespaced cursor emitted by the real API', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const diagnostics: EventSocketModule.RealtimeDiagnosticEvent[] = []
    const offDiagnostic = eventSocketModule.eventSocket.onDiagnosticEvent((event) =>
      diagnostics.push(event),
    )
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event.type),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.onmessage?.({ data: 's\napi-boot-a:1\nsess-a\n{"type":"run.started"}' })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))
    ws.onmessage?.({ data: 's\napi-boot-a:2\nsess-a\n{"missing":"type"}' })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))
    await flushMicrotasks()

    expect(seen).toEqual(['run.started'])
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
    expect(diagnostics).toMatchObject([
      {
        kind: 'frame.session.invalid',
        severity: 'error',
        sessionId: 'sess-a',
      },
    ])
    expect(eventSocketModule.runScheduledReconnectForTests()).toBeTrue()
    expect(new URL(FakeWebSocket.instances[1].url).searchParams.get('since')).toBe('api-boot-a:1')

    unsubscribe()
    offDiagnostic()
  })

  it('fails fast instead of silently dropping an unsupported numeric cursor', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event.type),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.onmessage?.({ data: 's\n1\nsess-a\n{"type":"run.started"}' })
    await flushMicrotasks()

    expect(seen).toEqual([])
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
    unsubscribe()
  })

  it('merges adjacent message deltas before notifying the store', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: AgentStreamEvent[] = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.onmessage?.({
      data: `s\napi-boot-a:1\nsess-a\n${JSON.stringify({ type: 'message.delta', sessionId: 'sess-a', messageId: 'm1', textItemId: 'text-0', textAppend: 'hello ' })}`,
    })
    ws.onmessage?.({
      data: `s\napi-boot-a:2\nsess-a\n${JSON.stringify({ type: 'message.delta', sessionId: 'sess-a', messageId: 'm1', textItemId: 'text-0', textAppend: 'world' })}`,
    })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))

    expect(seen).toEqual([
      {
        type: 'message.delta',
        sessionId: 'sess-a',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend: 'hello world',
        reasoningAppend: undefined,
        contentAppend: undefined,
        itemAppends: undefined,
      },
    ])
    unsubscribe()
  })

  it('keeps coalesced item appends in wire order', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: AgentStreamEvent[] = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()
    const delta = (sequence: number, append: string) =>
      `s\napi-boot-a:${sequence}\nsess-a\n${JSON.stringify({
        type: 'message.delta',
        sessionId: 'sess-a',
        messageId: 'm1',
        itemAppends: [{ itemId: 'tool-1', slot: 'output', append }],
      })}`

    ws.onmessage?.({ data: delta(1, 'A') })
    ws.onmessage?.({ data: delta(2, 'B') })
    ws.onmessage?.({ data: delta(3, 'C') })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      type: 'message.delta',
      itemAppends: [
        { itemId: 'tool-1', slot: 'output', append: 'A' },
        { itemId: 'tool-1', slot: 'output', append: 'B' },
        { itemId: 'tool-1', slot: 'output', append: 'C' },
      ],
    })
    unsubscribe()
  })

  it('drops duplicate and out-of-order session frames before delta coalescing', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: AgentStreamEvent[] = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()
    const delta = (seq: string, textAppend: string) =>
      `s\napi-boot-a:${seq}\nsess-a\n${JSON.stringify({
        type: 'message.delta',
        sessionId: 'sess-a',
        messageId: 'm1',
        textItemId: 'text-0',
        textAppend,
      })}`

    ws.onmessage?.({ data: delta('10', 'A') })
    ws.onmessage?.({ data: delta('10', 'A') }) // duplicate replay boundary
    ws.onmessage?.({ data: delta('9', 'stale') })
    ws.onmessage?.({ data: delta('11', 'B') })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'message.delta', textAppend: 'AB' })
    unsubscribe()
  })

  // React StrictMode probes every effect with setup → cleanup → setup in one
  // synchronous turn. The committed owner should inherit the connecting socket,
  // not close it and create another connection that warns in the browser console.
  it('a same-turn re-subscribe reuses the connecting socket', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    // mount → unmount → mount within one tick (StrictMode / HMR).
    const unsub1 = eventSocketModule.eventSocket.onSessionEvent(() => {})
    expect(FakeWebSocket.instances).toHaveLength(1)

    unsub1() // release(): arms an end-of-turn disconnect
    const unsub2 = eventSocketModule.eventSocket.onSessionEvent(() => {}) // retain(): cancels it
    await flushMicrotasks()
    expect(FakeWebSocket.instances).toHaveLength(1)
    const reused = FakeWebSocket.instances[0]
    const nonClosed = FakeWebSocket.instances.filter((s) => s.readyState !== FakeWebSocket.CLOSED)
    expect(nonClosed).toEqual([reused])

    reused.open()
    expect(eventSocketModule.getEventSocketDebugStateForTests().refCount).toBe(1)

    unsub2()
    await flushMicrotasks()
    expect(reused.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('cancels server work when a request times out locally', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const request = eventSocketModule.eventSocket.request(
      { t: 'predictNextEdit' },
      { timeoutMs: 50 },
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()
    expect(request).rejects.toMatchObject({ code: 'ws_timeout' })
    expect(ws.sent.map((frame) => JSON.parse(frame))).toEqual([
      { t: 'predictNextEdit', id: 'q1' },
      { id: 'cancel:q1', t: 'cancel', requestId: 'q1' },
    ])
  })

  it('tells subscribers the socket went DOWN at the moment it drops', async () => {
    // The gap this closes: `onReconnect` fires on the way BACK UP, so a liveness flag
    // fed only by it means "last heard live" and stays true for the whole outage —
    // precisely when a fallback poll is the only feed left.
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const offDown = eventSocketModule.eventSocket.onDisconnect(() => seen.push('down'))
    const offUp = eventSocketModule.eventSocket.onReconnect(() => seen.push('up'))
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})

    FakeWebSocket.instances[0].open()
    await flushMicrotasks()
    // Nothing yet: an open socket is neither down nor reconnected.
    expect(seen).toEqual([])

    FakeWebSocket.instances[0].close()
    await flushMicrotasks()
    // DOWN must arrive here — while the socket is gone — not later.
    expect(seen).toEqual(['down'])

    offDown()
    offUp()
    unsubscribe()
  })

  it('isolates disconnect handlers so one failure cannot block reconnect', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const error = mock(() => {})
    const previousError = console.error
    console.error = error
    const offBad = eventSocketModule.eventSocket.onDisconnect(() => {
      throw new Error('broken feature disconnect')
    })
    const offGood = eventSocketModule.eventSocket.onDisconnect(() => seen.push('down'))
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})
    try {
      FakeWebSocket.instances[0].open()
      FakeWebSocket.instances[0].close()
      await flushMicrotasks()
      expect(seen).toEqual(['down'])
      expect(error).toHaveBeenCalledTimes(1)

      expect(eventSocketModule.runScheduledReconnectForTests()).toBeTrue()
      expect(FakeWebSocket.instances).toHaveLength(2)
    } finally {
      console.error = previousError
      offBad()
      offGood()
      unsubscribe()
    }
  })

  it('coalesces session frames into one synchronous drain (one React render pass per burst)', async () => {
    // Each ws message is its own macrotask; applying frames straight from
    // onmessage gave React one render pass PER FRAME. The batch drain delivers
    // a whole burst inside one task so React 18 auto-batching collapses it.
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: Array<{ sessionId: string; type: string }> = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((sid, event) =>
      seen.push({ sessionId: sid, type: event.type }),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.onmessage?.({
      data: `s\napi-boot-a:1\nsess-a\n${JSON.stringify({ type: 'run.started' })}`,
    })
    ws.onmessage?.({
      data: `s\napi-boot-a:2\nsess-b\n${JSON.stringify({ type: 'run.started' })}`,
    })
    // Not delivered synchronously — buffered for the batch drain.
    expect(seen).toEqual([])

    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))
    // Both frames arrived, in receipt order, from one drain.
    expect(seen).toEqual([
      { sessionId: 'sess-a', type: 'run.started' },
      { sessionId: 'sess-b', type: 'run.started' },
    ])

    unsubscribe()
  })

  it('reconciles instead of presenting a silently truncated session after a lag marker', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const reconnects: string[] = []
    const diagnostics: EventSocketModule.RealtimeDiagnosticEvent[] = []
    const offDiagnostic = eventSocketModule.eventSocket.onDiagnosticEvent((event) =>
      diagnostics.push(event),
    )
    const offReconnect = eventSocketModule.eventSocket.onReconnect(() =>
      reconnects.push('reconcile'),
    )
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event.type),
    )
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.onmessage?.({
      data:
        's\napi-boot-a:7\nsess-a\n' +
        JSON.stringify({
          type: 'transport.lagged',
          skipped: 3,
          eventType: 'message.delta',
        }),
    })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))

    expect(seen).toEqual([])
    expect(reconnects).toEqual(['reconcile'])
    expect(diagnostics).toMatchObject([
      {
        kind: 'stream.lagged',
        severity: 'warning',
        sessionId: 'sess-a',
        attributes: { skipped: 3, eventType: 'message.delta' },
      },
    ])

    unsubscribe()
    offReconnect()
    offDiagnostic()
  })

  it('does not acknowledge a buffered frame after the final subscriber leaves', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent((_sid, event) =>
      seen.push(event.type),
    )
    const first = FakeWebSocket.instances[0]
    first.open()
    first.onmessage?.({ data: 's\napi-boot-a:41\nsess-a\n{"type":"message.delta"}' })

    unsubscribe()
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))
    expect(seen).toEqual([])

    const unsubscribeAgain = eventSocketModule.eventSocket.onSessionEvent(() => {})
    expect(new URL(FakeWebSocket.instances[1].url).searchParams.get('since')).toBeNull()
    unsubscribeAgain()
  })

  it('reconciles after an idle teardown and later remount', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const reconnects: string[] = []
    const offReconnect = eventSocketModule.eventSocket.onReconnect(() =>
      reconnects.push('reconcile'),
    )
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})
    const first = FakeWebSocket.instances[0]
    first.open()
    first.onmessage?.({ data: 's\napi-boot-a:41\nsess-a\n{"type":"run.started"}' })
    await new Promise((resolve) => setTimeout(resolve, eventSocketModule.SESSION_FLUSH_MS + 20))

    unsubscribe()
    await flushMicrotasks()
    expect(first.readyState).toBe(FakeWebSocket.CLOSED)

    const unsubscribeAgain = eventSocketModule.eventSocket.onSessionEvent(() => {})
    const resumed = FakeWebSocket.instances[1]
    expect(new URL(resumed.url).searchParams.get('since')).toBe('api-boot-a:41')
    resumed.open()
    expect(reconnects).toEqual(['reconcile'])

    unsubscribeAgain()
    offReconnect()
  })

  it('still fires reconnect on the way back up, and only then', async () => {
    // The reverse direction: the new hook must not displace or pre-empt `onReconnect`.
    // If this goes red, every subscriber that reconciles on reconnect stopped doing so.
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const offDown = eventSocketModule.eventSocket.onDisconnect(() => seen.push('down'))
    const offUp = eventSocketModule.eventSocket.onReconnect(() => seen.push('up'))
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})

    FakeWebSocket.instances[0].open()
    await flushMicrotasks()
    FakeWebSocket.instances[0].close()
    await flushMicrotasks()
    expect(seen).toEqual(['down'])

    // Execute the scheduled reconnect and drive the replacement socket open.
    expect(eventSocketModule.runScheduledReconnectForTests()).toBeTrue()
    FakeWebSocket.instances[1].open()
    await flushMicrotasks()
    expect(seen).toEqual(['down', 'up'])

    offDown()
    offUp()
    unsubscribe()
  })

  it('isolates reconnect handlers so one failure cannot strand queued RPCs', async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const seen: string[] = []
    const error = mock(() => {})
    const previousError = console.error
    console.error = error
    const offBad = eventSocketModule.eventSocket.onReconnect(() => {
      throw new Error('broken feature reconcile')
    })
    const offGood = eventSocketModule.eventSocket.onReconnect(() => seen.push('good'))
    const unsubscribe = eventSocketModule.eventSocket.onSessionEvent(() => {})
    try {
      FakeWebSocket.instances[0].open()
      FakeWebSocket.instances[0].close()
      await flushMicrotasks()
      expect(eventSocketModule.runScheduledReconnectForTests()).toBeTrue()
      const replacement = FakeWebSocket.instances[1]
      const pending = eventSocketModule.eventSocket.request({ t: 'run_terminal' })
      replacement.open()
      expect(seen).toEqual(['good'])
      expect(error).toHaveBeenCalledTimes(1)
      expect(replacement.sent).toHaveLength(1)
      void pending.catch(() => {})
    } finally {
      console.error = previousError
      offBad()
      offGood()
      unsubscribe()
    }
  })
})
