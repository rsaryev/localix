import { describe, expect, test } from 'bun:test'
import { createBackpressuredWriter, type BackpressureSocket } from './backpressure'

/**
 * A fake Bun ServerWebSocket whose send buffer NEVER drains on its own — every
 * `send` grows `buffered`, and only an explicit `drain()` (a real socket flushing)
 * lowers it. This simulates a STALLED browser socket: `getBufferedAmount()` climbs
 * without bound if the producer keeps sending. Bun-ws-shaped: the guard reads
 * `ws.raw.getBufferedAmount()`, exactly as it does against the real socket.
 */
function stalledSocket() {
  let buffered = 0
  let closed = false
  let closeCode: number | undefined
  const sent: string[] = []
  const ws: BackpressureSocket = {
    send(data) {
      sent.push(data)
      buffered += data.length // a stalled socket never flushes what we hand it
    },
    close(code) {
      closed = true
      closeCode = code
    },
    raw: { getBufferedAmount: () => buffered },
  }
  return {
    ws,
    /** Simulate the real socket flushing its buffer (consumer caught up). */
    drain(to = 0) {
      buffered = to
    },
    get bufferedBytes() {
      return buffered
    },
    get sentFrames() {
      return sent
    },
    get sentBytes() {
      return sent.reduce((a, b) => a + b.length, 0)
    },
    get closed() {
      return closed
    },
    get closeCode() {
      return closeCode
    },
  }
}

/** A manual timer seam so drain polling is deterministic (no real timers). */
function manualScheduler() {
  let pending: (() => void) | null = null
  return {
    schedule: (fn: () => void) => {
      pending = fn
      return 1 as const
    },
    cancel: () => {
      pending = null
    },
    /** Run the single scheduled drain tick, if any (it may reschedule itself). */
    tick() {
      const fn = pending
      pending = null
      fn?.()
    },
    get hasPending() {
      return pending !== null
    },
  }
}

const frame = (n: number) => 'x'.repeat(n)

describe('terminal WS backpressure — characterizing the bug', () => {
  // The OLD code path: `ws.send(JSON.stringify(frame))` per PTY frame, no buffer
  // check. Against a stalled socket the send buffer grows PROPORTIONALLY to the
  // number of frames — unbounded. This is the OOM the fix must eliminate.
  test('bare per-frame send grows the socket buffer without bound', () => {
    const small = stalledSocket()
    for (let i = 0; i < 50; i++) small.ws.send(frame(1000))
    const big = stalledSocket()
    for (let i = 0; i < 500; i++) big.ws.send(frame(1000))
    // 10x the frames → ~10x the buffered bytes: growth is unbounded in the input.
    expect(big.bufferedBytes).toBe(500_000)
    expect(small.bufferedBytes).toBe(50_000)
    expect(big.bufferedBytes / small.bufferedBytes).toBeCloseTo(10, 0)
  })
})

describe('BackpressuredWriter — bounded fan-out', () => {
  // The FIX: no matter how many frames a stalled socket is fed, the bytes handed
  // to the socket stay bounded (≈ high-water) and the local queue never exceeds
  // the hard cap. MUTATION: revert `write()` to a bare `ws.send(frame)` (drop the
  // gate) and this test goes RED — sentBytes/queuedBytes grow with the input.
  test('a stalled socket is bounded and then shed (never unbounded)', () => {
    const sock = stalledSocket()
    const sched = manualScheduler()
    const shed: true[] = []
    const writer = createBackpressuredWriter(sock.ws, {
      highWaterBytes: 1000,
      hardCapBytes: 5000,
      schedule: sched.schedule,
      cancel: sched.cancel,
      onShed: () => shed.push(true),
    })

    // Feed far more than any bound (100 KB) into a socket that never drains.
    for (let i = 0; i < 1000; i++) writer.write(frame(100))

    // Bytes actually handed to the socket are bounded near the high-water mark,
    // NOT proportional to the 100 KB we fed it.
    expect(sock.sentBytes).toBeLessThanOrEqual(1000 + 100)
    // The local queue never blew past the hard cap.
    expect(writer.queuedBytes).toBeLessThanOrEqual(5000)
    // The hopeless consumer was shed (closed), not left to OOM the process.
    expect(sock.closed).toBe(true)
    expect(sock.closeCode).toBe(1009)
    expect(shed).toHaveLength(1)
  })

  test('once shed, further writes are inert (no more bytes, stays closed)', () => {
    const sock = stalledSocket()
    const sched = manualScheduler()
    const writer = createBackpressuredWriter(sock.ws, {
      highWaterBytes: 1000,
      hardCapBytes: 5000,
      schedule: sched.schedule,
      cancel: sched.cancel,
    })
    for (let i = 0; i < 1000; i++) writer.write(frame(100))
    expect(writer.isClosed).toBe(true)
    const afterShed = sock.sentBytes
    for (let i = 0; i < 1000; i++) writer.write(frame(100))
    expect(sock.sentBytes).toBe(afterShed)
  })
})

describe('BackpressuredWriter — a recovering consumer loses no bytes', () => {
  test('frames queued during backpressure flush in order once the socket drains', () => {
    const sock = stalledSocket()
    const sched = manualScheduler()
    const writer = createBackpressuredWriter(sock.ws, {
      highWaterBytes: 1000,
      hardCapBytes: 1_000_000,
      schedule: sched.schedule,
      cancel: sched.cancel,
    })

    // First frames send directly and push the buffer over the high-water mark.
    for (let i = 0; i < 20; i++) writer.write(`f${i}`.padEnd(100, '-'))
    const directlySent = sock.sentFrames.length
    expect(directlySent).toBeGreaterThan(0)
    expect(writer.queuedBytes).toBeGreaterThan(0) // the rest are queued, not dropped

    // The socket catches up; each drain tick flushes what fits under the mark.
    let guard = 0
    while (sched.hasPending && guard++ < 100) {
      sock.drain(0)
      sched.tick()
    }

    // Every frame was delivered exactly once, in order — nothing dropped.
    expect(sock.sentFrames).toHaveLength(20)
    for (let i = 0; i < 20; i++) expect(sock.sentFrames[i].startsWith(`f${i}-`)).toBe(true)
    expect(writer.queuedBytes).toBe(0)
    expect(sock.closed).toBe(false)
  })
})

describe('BackpressuredWriter — gone-socket release (cancellation)', () => {
  test('dispose clears the backlog and cancels the drain timer', () => {
    const sock = stalledSocket()
    const sched = manualScheduler()
    const writer = createBackpressuredWriter(sock.ws, {
      highWaterBytes: 1000,
      hardCapBytes: 1_000_000,
      schedule: sched.schedule,
      cancel: sched.cancel,
    })
    for (let i = 0; i < 50; i++) writer.write(frame(100))
    expect(writer.queuedBytes).toBeGreaterThan(0)
    expect(sched.hasPending).toBe(true)

    // The socket closed while backed up → the ws close path disposes the writer.
    writer.dispose()
    expect(writer.queuedBytes).toBe(0)
    expect(sched.hasPending).toBe(false) // drain timer cancelled — no wedged work
    expect(writer.isClosed).toBe(true)

    // A late tick (already-fired timer racing dispose) is a harmless no-op.
    const before = sock.sentBytes
    sched.tick()
    expect(sock.sentBytes).toBe(before)
  })

  test('dispose is idempotent', () => {
    const sock = stalledSocket()
    const writer = createBackpressuredWriter(sock.ws, { highWaterBytes: 1000 })
    writer.dispose()
    expect(() => writer.dispose()).not.toThrow()
    expect(writer.isClosed).toBe(true)
  })
})
