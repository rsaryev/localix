/**
 * Coalesces a PTY's output chunks into whole WebSocket frames.
 *
 * A PTY does not hand out data in the sizes a terminal produces it — it hands out
 * whatever fits its read buffer, which Bun caps at 1 KB. Measured on a real PTY here:
 * `ls -R apps` emitted 12,942 chunks for 1.18 MB (median 76 bytes), and even a dense
 * `cat` of two large files was 1,024 bytes per chunk, every chunk. In both, ~100% of
 * chunks arrived within 2 ms of the previous one. The stream layer sent one JSON frame
 * per chunk, so a megabyte of build log cost the client roughly a thousand WebSocket
 * messages — each one its own `JSON.parse` and xterm `write()` on the UI thread. The
 * cost is the FRAME COUNT, not the bytes: `JSON.stringify` over all 12,942 chunks
 * measured only 4 ms.
 *
 * LEADING EDGE, then coalesce. The first chunk after an idle period is emitted
 * SYNCHRONOUSLY, with no added latency — that is the one that matters, because it is
 * the echo of the key the user just pressed. Only chunks arriving while that window is
 * still open are merged, which is exactly the flood case and never the interactive one.
 * A trailing-edge batcher would have delayed every keystroke echo by the window; this
 * delays nothing a human waits on.
 *
 * Byte cap: a flood inside one window must not accumulate without bound, so passing
 * `maxBytes` flushes early. Terminal bytes are never dropped or reordered — merging is
 * concatenation, and the emulator's view of the stream is byte-identical either way.
 *
 * The scheduler is injected so the policy is unit-testable without real timers, matching
 * `backpressure.ts` (the other half of this transport).
 */

export interface OutputCoalescerOptions {
  /** How long the merge window stays open after a frame goes out. */
  windowMs?: number
  /** Flush early once this many bytes have accumulated in the open window. */
  maxBytes?: number
  /** Timer seam (defaults to setTimeout); tests inject a manual scheduler. */
  schedule?: (fn: () => void, ms: number) => unknown
  /** Cancels a handle from {@link schedule} (defaults to clearTimeout). */
  cancel?: (handle: unknown) => void
}

/**
 * 8 ms: under half a 60 Hz display frame, so a merged frame still lands in the same
 * repaint the un-merged chunks would have, while spanning enough of the 0.003 ms
 * inter-chunk gap a flood produces to collapse thousands of frames into one.
 */
const WINDOW_MS = 8
/** Flush early past 256 KB in one window — bounds the merge buffer under any burst. */
const MAX_BYTES = 256 * 1024

export class OutputCoalescer {
  private readonly emit: (data: string) => void
  private readonly pending: string[] = []
  private pendingBytes = 0
  private timer: unknown
  private closed = false
  private readonly windowMs: number
  private readonly maxBytes: number
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancelTimer: (handle: unknown) => void

  constructor(emit: (data: string) => void, opts: OutputCoalescerOptions = {}) {
    this.emit = emit
    this.windowMs = opts.windowMs ?? WINDOW_MS
    this.maxBytes = opts.maxBytes ?? MAX_BYTES
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancelTimer = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** Bytes merged so far in the open window (sensing point for tests). */
  get pendingByteCount(): number {
    return this.pendingBytes
  }

  push(data: string): void {
    if (this.closed || data.length === 0) return
    if (this.timer === undefined) {
      // Idle: this chunk is (or could be) an echo — send it now and open the window.
      this.emit(data)
      this.arm()
      return
    }
    this.pending.push(data)
    this.pendingBytes += data.length
    if (this.pendingBytes >= this.maxBytes) {
      this.cancelPending()
      this.flushPending()
      this.arm()
    }
  }

  /**
   * Emit whatever is merged right now. Used before an out-of-band frame that must not
   * overtake the output it follows — notably `exit`, which would otherwise reach the
   * client ahead of the process's own last lines.
   */
  flush(): void {
    if (this.closed) return
    this.flushPending()
  }

  /** Release the timer and drop anything unsent (the socket is gone). Idempotent. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.cancelPending()
    this.pending.length = 0
    this.pendingBytes = 0
  }

  private arm(): void {
    this.timer = this.schedule(() => this.onWindowEnd(), this.windowMs)
  }

  private onWindowEnd(): void {
    this.timer = undefined
    if (this.closed) return
    // Re-arm only while data is still flowing: an idle terminal must stop scheduling
    // work rather than tick forever, and the next chunk then takes the leading edge.
    if (this.pendingBytes > 0) {
      this.flushPending()
      this.arm()
    }
  }

  private flushPending(): void {
    if (this.pending.length === 0) return
    const merged = this.pending.join('')
    this.pending.length = 0
    this.pendingBytes = 0
    this.emit(merged)
  }

  private cancelPending(): void {
    if (this.timer === undefined) return
    this.cancelTimer(this.timer)
    this.timer = undefined
  }
}

/** Factory mirroring the feature's other constructors. */
export function createOutputCoalescer(
  emit: (data: string) => void,
  opts?: OutputCoalescerOptions,
): OutputCoalescer {
  return new OutputCoalescer(emit, opts)
}
