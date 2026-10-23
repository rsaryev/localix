import { describe, expect, test } from 'bun:test'
import type { ExchangeStreamBackend, StreamChannel, StreamParams, StreamPayload } from './backend'
import {
  type StreamTimers,
  type TradingStreamFrame,
  backoffDelay,
  createTradingStreamRegistry,
  streamKeyOf,
} from './stream'

// ── Test doubles ───────────────────────────────────────────────────────────────

/** A manually-advanced clock so idle-TTL, live-settle and backoff are deterministic. */
class FakeClock implements StreamTimers {
  private seq = 0
  private timers = new Map<number, { fn: () => void; at: number }>()
  now = 0
  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.set(id, { fn, at: this.now + ms })
    return id
  }
  clear(handle: unknown): void {
    this.timers.delete(handle as number)
  }
  /** Advance time and fire everything now due (timers scheduled during firing may fire too). */
  advance(ms: number): void {
    this.now += ms
    let ran = true
    while (ran) {
      ran = false
      // Snapshot: the body both deletes from `this.timers` and runs callbacks that schedule
      // new ones, so iterating the live Map would fire timers this very pass just created.
      for (const [id, t] of Array.from(this.timers)) {
        if (t.at <= this.now) {
          this.timers.delete(id)
          ran = true
          t.fn()
        }
      }
    }
  }
}

/** A fake streaming client: `watch` stays pending until the test ends it or the signal aborts. */
class FakeBackend implements ExchangeStreamBackend {
  watchCalls = 0
  stopCount = 0
  closeCount = 0
  supportsFn: (channel: StreamChannel) => boolean = () => true
  lastSignal: AbortSignal | null = null
  private current: {
    resolve: () => void
    reject: (e: unknown) => void
    onData: (p: StreamPayload) => void
  } | null = null

  supports(channel: StreamChannel): boolean {
    return this.supportsFn(channel)
  }
  watch(
    _params: StreamParams,
    onData: (payload: StreamPayload) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.watchCalls++
    this.lastSignal = signal
    return new Promise<void>((resolve, reject) => {
      this.current = { resolve, reject, onData }
      signal.addEventListener('abort', () => resolve())
    })
  }
  stop(): void {
    this.stopCount++
  }
  async close(): Promise<void> {
    this.closeCount++
  }

  emit(payload: StreamPayload): void {
    this.current?.onData(payload)
  }
  endClean(): void {
    this.current?.resolve()
  }
  endWithError(err: unknown): void {
    this.current?.reject(err)
  }
}

/** Factory that hands out one FakeBackend per connectionId, remembering each. */
function fakeFactory() {
  const byConnection = new Map<string, FakeBackend>()
  const created: FakeBackend[] = []
  const createStream = async (connectionId: string): Promise<ExchangeStreamBackend | null> => {
    let b = byConnection.get(connectionId)
    if (!b) {
      b = new FakeBackend()
      byConnection.set(connectionId, b)
      created.push(b)
    }
    return b
  }
  return { createStream, byConnection, created }
}

/** Flush pending microtasks (the registry's async client-build + `.then` chains). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

const TICKER: StreamParams = { channel: 'ticker', symbol: 'BTC/USDC' }
const tickerPayload: StreamPayload = {
  channel: 'ticker',
  symbol: 'BTC/USDC',
  ticker: { symbol: 'BTC/USDC', timestamp: 1, last: 100 },
}

function sink() {
  const frames: TradingStreamFrame[] = []
  return { onFrame: (f: TradingStreamFrame) => frames.push(f), frames }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  test('backoffDelay doubles and caps', () => {
    expect(backoffDelay(0, 1000, 15000)).toBe(0)
    expect(backoffDelay(1, 1000, 15000)).toBe(1000)
    expect(backoffDelay(2, 1000, 15000)).toBe(2000)
    expect(backoffDelay(3, 1000, 15000)).toBe(4000)
    expect(backoffDelay(10, 1000, 15000)).toBe(15000)
  })

  test('streamKeyOf is stable and separates the tuple fields', () => {
    expect(streamKeyOf('c1', { channel: 'ohlcv', symbol: 'ETH/USDC', timeframe: '1m' })).toBe(
      'c1\nohlcv\nETH/USDC\n1m',
    )
    expect(streamKeyOf('c1', { channel: 'ticker' })).toBe('c1\nticker\n\n')
    // Distinct symbols / timeframes never collide.
    expect(streamKeyOf('c1', { channel: 'ticker', symbol: 'A' })).not.toBe(
      streamKeyOf('c1', { channel: 'ticker', symbol: 'B' }),
    )
  })
})

// ── Registry ───────────────────────────────────────────────────────────────────

describe('TradingStreamRegistry', () => {
  test('spawns the loop + client on the first subscriber (0→1)', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({ createStream: f.createStream, timers: clock })
    const s = sink()
    reg.subscribe('c1', TICKER, s)
    await flush()
    expect(f.created).toHaveLength(1)
    expect(f.created[0].watchCalls).toBe(1)
    expect(reg.size).toBe(1)
    expect(reg.clientCount).toBe(1)
  })

  test('two subscribers share ONE spawn and both receive data', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({ createStream: f.createStream, timers: clock })
    const a = sink()
    const b = sink()
    reg.subscribe('c1', TICKER, a)
    await flush()
    reg.subscribe('c1', TICKER, b)
    await flush()
    expect(f.created[0].watchCalls).toBe(1) // shared, not respawned
    f.created[0].emit(tickerPayload)
    expect(a.frames.some((fr) => fr.kind === 'data')).toBe(true)
    expect(b.frames.some((fr) => fr.kind === 'data')).toBe(true)
  })

  test('tears down after the last unsubscribe + idle grace, closing the client once', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({
      createStream: f.createStream,
      timers: clock,
      idleTtlMs: 5000,
    })
    const s = sink()
    const off = reg.subscribe('c1', TICKER, s)
    await flush()
    const backend = f.created[0]
    off()
    expect(backend.closeCount).toBe(0) // still in grace
    clock.advance(5000)
    await flush()
    expect(backend.stopCount).toBe(1)
    expect(backend.closeCount).toBe(1)
    expect(backend.lastSignal?.aborted).toBe(true)
    expect(reg.size).toBe(0)
    expect(reg.clientCount).toBe(0)
  })

  test('idle-TTL grace: a fast re-subscribe reuses the running loop + client', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({
      createStream: f.createStream,
      timers: clock,
      idleTtlMs: 5000,
    })
    const off = reg.subscribe('c1', TICKER, sink())
    await flush()
    off()
    clock.advance(2000) // inside the grace window
    reg.subscribe('c1', TICKER, sink())
    await flush()
    clock.advance(10000) // the old idle timer must have been cancelled
    await flush()
    expect(f.created).toHaveLength(1)
    expect(f.created[0].watchCalls).toBe(1)
    expect(f.created[0].closeCount).toBe(0)
  })

  test('restarts with backoff after a loop throws, transitioning live→down→live', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({
      createStream: f.createStream,
      timers: clock,
      backoffBaseMs: 1000,
      backoffMaxMs: 15000,
      liveAfterMs: 100000, // only explicit data marks live in this test
    })
    const s = sink()
    reg.subscribe('c1', TICKER, s)
    await flush()
    const backend = f.created[0]
    backend.emit(tickerPayload) // → live
    expect(s.frames.some((fr) => fr.kind === 'status' && fr.status === 'live')).toBe(true)
    backend.endWithError(new Error('socket dropped'))
    await flush()
    expect(s.frames.some((fr) => fr.kind === 'status' && fr.status === 'down')).toBe(true)
    expect(backend.watchCalls).toBe(1)
    clock.advance(1000) // first backoff
    await flush()
    expect(backend.watchCalls).toBe(2) // restarted
  })

  test('caps consecutive never-live failures then stops respawning', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({
      createStream: f.createStream,
      timers: clock,
      backoffBaseMs: 1000,
      backoffMaxMs: 15000,
      liveAfterMs: 100000,
      maxImmediateFailures: 3,
    })
    reg.subscribe('c1', TICKER, sink())
    await flush()
    const backend = f.created[0]
    // Fail immediately (never emit → never live) enough times to exhaust the budget.
    for (let i = 0; i < 5; i++) {
      backend.endWithError(new Error('reject'))
      await flush()
      clock.advance(15000)
      await flush()
    }
    expect(backend.watchCalls).toBe(3) // 1 initial + 2 restarts, then capped
    clock.advance(60000)
    await flush()
    expect(backend.watchCalls).toBe(3) // no further respawn
  })

  test('a fresh subscribe after the cap resets the budget and retries', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({
      createStream: f.createStream,
      timers: clock,
      backoffBaseMs: 1000,
      liveAfterMs: 100000,
      maxImmediateFailures: 2,
    })
    const off = reg.subscribe('c1', TICKER, sink())
    await flush()
    const backend = f.created[0]
    for (let i = 0; i < 3; i++) {
      backend.endWithError(new Error('reject'))
      await flush()
      clock.advance(15000)
      await flush()
    }
    expect(backend.watchCalls).toBe(2) // capped
    off() // drop the original subscriber (still within grace, entry alive)
    reg.subscribe('c1', TICKER, sink())
    await flush()
    expect(backend.watchCalls).toBe(3) // budget reset → retried
  })

  test('refuses a private channel on a credential-less connection (never opens a loop)', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    // Simulate no credentials: supports() is false for the private channel.
    const reg = createTradingStreamRegistry({
      createStream: async (id) => {
        const b = new FakeBackend()
        b.supportsFn = (channel) => channel !== 'orders'
        f.byConnection.set(id, b)
        f.created.push(b)
        return b
      },
      timers: clock,
    })
    const s = sink()
    reg.subscribe('c1', { channel: 'orders' }, s)
    await flush()
    expect(f.created[0].watchCalls).toBe(0) // no authenticated stream opened
    expect(s.frames.every((fr) => fr.kind !== 'status' || fr.status === 'down')).toBe(true)
  })

  test('stopAll closes every client exactly once', async () => {
    const clock = new FakeClock()
    const f = fakeFactory()
    const reg = createTradingStreamRegistry({ createStream: f.createStream, timers: clock })
    reg.subscribe('c1', TICKER, sink())
    reg.subscribe('c2', { channel: 'trades', symbol: 'ETH/USDC' }, sink())
    await flush()
    expect(reg.clientCount).toBe(2)
    reg.stopAll()
    await flush()
    for (const b of f.created) {
      expect(b.closeCount).toBe(1)
      expect(b.stopCount).toBe(1)
    }
    expect(reg.size).toBe(0)
    expect(reg.clientCount).toBe(0)
  })
})
