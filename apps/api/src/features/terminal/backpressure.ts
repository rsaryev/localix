/**
 * Per-socket backpressure guard for the terminal WebSocket fan-out.
 *
 * The problem (Release It! — a fast producer must not OOM the process against a
 * slow consumer): a PTY can emit output far faster than a STALLED browser socket
 * (backgrounded tab, slow network) drains it. A bare `ws.send()` per PTY frame
 * grows Bun's per-socket send buffer WITHOUT BOUND → the API process OOMs.
 *
 * Terminal frames CANNOT be dropped mid-stream — dropping bytes corrupts the
 * rendered terminal (unlike the realtime mux, whose live-only frames are resynced
 * by the next snapshot). So the two correct options are (a) pause the producer, or
 * (b) shed the slow consumer. On Bun BOTH the producer-pause and an event-driven
 * drain are unavailable:
 *
 *   - Bun's PTY (`Bun.spawn(..., { terminal })`, Bun 1.3.x) exposes only
 *     write/resize/close/setRawMode/ref/unref — NO pause()/resume(), and its
 *     `data` callback is an unstoppable push pump. There is no way to apply OS
 *     flow-control back to the writing process through the current API.
 *   - hono/bun's websocket handler forwards only open/close/message — Bun's native
 *     `drain` callback is NOT surfaced to route handlers. So drain must be POLLED
 *     via `ws.raw.getBufferedAmount()`.
 *
 * Therefore this guard implements **load-shedding with a bounded buffer**:
 *   1. While the socket's send buffer is below the high-water mark, send directly.
 *   2. Once it exceeds the high-water mark, STOP calling `ws.send` (that is what
 *      grows Bun's buffer unboundedly) and queue frames locally, in order, bounded.
 *   3. Poll for drain; when the buffer falls back under the mark, flush the queue
 *      in order — no bytes are ever dropped for a consumer that recovers.
 *   4. If the local queue itself exceeds the hard cap, the consumer is hopelessly
 *      slow: SHED it — close that one socket. Never drop bytes, never OOM.
 *
 * Multi-subscriber isolation (a PTY session can have several socket subscribers):
 * each socket owns its OWN writer, so a slow socket sheds ITSELF without stalling
 * the healthy peers — strictly better blast-radius isolation than pausing the
 * shared PTY (which would head-of-line-block every healthy peer for one slow one).
 * There is nothing shared to "resume when all drained": each writer drains alone.
 *
 * Gone-socket release (the cancellation angle): a subscriber whose socket closed
 * while it held a backlog must release its hold so it stops scheduling work — the
 * ws close/unsubscribe path calls {@link BackpressuredWriter.dispose}, which clears
 * the queue and cancels the drain timer. A shed likewise closes → dispose. Both
 * paths are idempotent.
 *
 * The socket and the scheduler are injected so the whole policy is unit-testable
 * off any real PTY/socket/timer (Working Effectively with Legacy Code — inject the
 * boundary, sense the pure computation).
 */

/** The slice of a socket this guard needs — satisfied by hono's `WSContext`
 *  (`.raw` is Bun's `ServerWebSocket`, which exposes `getBufferedAmount()`). */
export interface BackpressureSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  raw?: { getBufferedAmount?: () => number }
}

export interface BackpressuredWriterOptions {
  /** Above this many buffered bytes, stop sending and queue locally. */
  highWaterBytes?: number
  /** Above this many LOCALLY-QUEUED bytes, shed (close) the socket. */
  hardCapBytes?: number
  /** Drain re-check interval while a backlog exists. */
  drainPollMs?: number
  /** Timer seam (defaults to setTimeout); tests inject a manual scheduler. */
  schedule?: (fn: () => void, ms: number) => unknown
  /** Cancels a handle from {@link schedule} (defaults to clearTimeout). */
  cancel?: (handle: unknown) => void
  /** Notified once when the socket is shed for unrecoverable backpressure. */
  onShed?: () => void
}

/** Default high-water mark: above ~1 MB buffered, the socket is backed up. */
const HIGH_WATER_BYTES = 1 * 1024 * 1024
/** Default hard cap: a socket that has let 16 MB queue up locally is hopeless. */
const HARD_CAP_BYTES = 16 * 1024 * 1024
/** Default drain poll interval. */
const DRAIN_POLL_MS = 50
/** WebSocket close code 1009 = "message too big" — the closest standard code for
 *  "this consumer cannot keep up with the stream, so we are closing it". */
const SHED_CLOSE_CODE = 1009
const SHED_CLOSE_REASON = 'terminal output backpressure'

export class BackpressuredWriter {
  private readonly queue: string[] = []
  private queuedBytesInternal = 0
  private draining = false
  private closed = false
  private timer: unknown
  private readonly highWater: number
  private readonly hardCap: number
  private readonly drainPollMs: number
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void
  private readonly ws: BackpressureSocket
  private readonly opts: BackpressuredWriterOptions

  constructor(ws: BackpressureSocket, opts: BackpressuredWriterOptions = {}) {
    this.ws = ws
    this.opts = opts
    this.highWater = opts.highWaterBytes ?? HIGH_WATER_BYTES
    this.hardCap = opts.hardCapBytes ?? HARD_CAP_BYTES
    this.drainPollMs = opts.drainPollMs ?? DRAIN_POLL_MS
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** Current send-buffer depth. 0 if the runtime doesn't expose it → the guard
   *  degrades to plain sending rather than mis-tripping (the safe direction). */
  private buffered(): number {
    return this.ws.raw?.getBufferedAmount?.() ?? 0
  }

  /** Locally-queued bytes awaiting drain (sensing point for tests). */
  get queuedBytes(): number {
    return this.queuedBytesInternal
  }

  /** True once the socket has been disposed or shed. */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Deliver one frame, applying backpressure. While a backlog exists OR the socket
   * is above the high-water mark, the frame is queued (never sent ahead of queued
   * frames — order is preserved); otherwise it is sent immediately.
   */
  write(frame: string): void {
    if (this.closed) return
    if (this.queue.length > 0 || this.buffered() > this.highWater) {
      this.enqueue(frame)
    } else {
      this.ws.send(frame)
    }
  }

  private enqueue(frame: string): void {
    this.queue.push(frame)
    this.queuedBytesInternal += frame.length
    if (this.queuedBytesInternal > this.hardCap) {
      this.shed()
      return
    }
    this.scheduleDrain()
  }

  private scheduleDrain(): void {
    if (this.draining || this.closed) return
    this.draining = true
    this.timer = this.schedule(() => this.drainTick(), this.drainPollMs)
  }

  private drainTick(): void {
    this.timer = undefined
    this.draining = false
    if (this.closed) return
    // Flush in order while the socket has headroom.
    while (this.queue.length > 0 && this.buffered() <= this.highWater) {
      const frame = this.queue.shift() as string
      this.queuedBytesInternal -= frame.length
      this.ws.send(frame)
    }
    // Still backed up → keep polling for drain.
    if (this.queue.length > 0) this.scheduleDrain()
  }

  /** Shed this consumer: it cannot drain the stream, so close its socket. */
  private shed(): void {
    if (this.closed) return
    this.dispose()
    this.opts.onShed?.()
    try {
      this.ws.close(SHED_CLOSE_CODE, SHED_CLOSE_REASON)
    } catch {
      /* socket already gone */
    }
  }

  /**
   * Release this writer's hold (the socket closed / unsubscribed). Idempotent:
   * clears the pending queue and cancels any drain timer so a gone consumer never
   * keeps scheduling work. Safe to call from the ws close path AND from {@link shed}.
   */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.queue.length = 0
    this.queuedBytesInternal = 0
    if (this.timer !== undefined) {
      this.cancel(this.timer)
      this.timer = undefined
    }
    this.draining = false
  }
}

/** Factory mirroring the feature's other constructors. */
export function createBackpressuredWriter(
  ws: BackpressureSocket,
  opts?: BackpressuredWriterOptions,
): BackpressuredWriter {
  return new BackpressuredWriter(ws, opts)
}
