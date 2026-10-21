import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type * as EventSocketModule from './eventSocket'
import { REPLAY_TRUST_MS } from './eventSocket/transport'

const NativeWebSocket = globalThis.WebSocket
let mod: typeof EventSocketModule

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  static readonly CLOSED = 3
  readonly url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(): void {}
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    queueMicrotask(() => this.onclose?.())
  }
}

const drained = () => new Promise((done) => setTimeout(done, mod.SESSION_FLUSH_MS + 20))

/** Open, apply one frame of boot `a`, drop, and dial again: the second socket resumes. */
async function reconnectAfterOneFrame() {
  const first = FakeWebSocket.instances[0]!
  first.open()
  first.onmessage?.({ data: 's\nboot-a:1\nsess\n{"type":"run.started"}' })
  await drained()
  first.close()
  await new Promise((done) => setTimeout(done, 0))
  expect(mod.runScheduledReconnectForTests()).toBeTrue()
  return FakeWebSocket.instances[1]!
}

describe('eventSocket replay verdict', () => {
  let resyncs = 0
  let stops: (() => void)[] = []
  beforeEach(async () => {
    mod = await import('./eventSocket')
    mod.resetEventSocketForTests()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    resyncs = 0
    stops = [
      mod.eventSocket.onSessionEvent(() => {}),
      mod.eventSocket.onResyncRequired(() => resyncs++),
    ]
  })
  afterEach(() => {
    for (const stop of stops) stop()
    mod.resetEventSocketForTests()
    globalThis.WebSocket = NativeWebSocket
  })

  it('a first open replays nothing', () => {
    FakeWebSocket.instances[0]!.open()
    expect(mod.eventSocket.resumedWithReplay()).toBeFalse()
  })

  it('a short outage resumed from the same boot replayed every missed frame', async () => {
    const second = await reconnectAfterOneFrame()
    expect(new URL(second.url).searchParams.get('since')).toBe('boot-a:1')
    second.open()
    expect(mod.eventSocket.resumedWithReplay()).toBeTrue()
    second.onmessage?.({ data: 's\nboot-a:2\nsess\n{"type":"run.started"}' })
    await drained()
    expect(mod.eventSocket.resumedWithReplay()).toBeTrue()
    expect(resyncs).toBe(0)
  })

  it('a restarted server withdraws the replay on its first frame', async () => {
    const second = await reconnectAfterOneFrame()
    second.open()
    second.onmessage?.({ data: 's\nboot-b:1\nsess\n{"type":"run.started"}' })
    await drained()
    expect(mod.eventSocket.resumedWithReplay()).toBeFalse()
    expect(resyncs).toBe(1)
  })

  it('a lag marker withdraws the replay', async () => {
    const second = await reconnectAfterOneFrame()
    second.open()
    second.onmessage?.({
      data: 's\nboot-a:5\nsess\n{"type":"transport.lagged","skipped":3,"eventType":"message.delta"}',
    })
    await drained()
    expect(mod.eventSocket.resumedWithReplay()).toBeFalse()
    expect(resyncs).toBe(1)
  })

  it('an outage longer than the replay ring is trusted for is a fresh stream', async () => {
    const second = await reconnectAfterOneFrame()
    const now = Date.now()
    const clock = spyOn(Date, 'now').mockReturnValue(now + REPLAY_TRUST_MS + 1)
    try {
      second.open()
      expect(mod.eventSocket.resumedWithReplay()).toBeFalse()
    } finally {
      clock.mockRestore()
    }
  })
})
