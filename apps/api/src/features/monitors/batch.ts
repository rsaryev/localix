/**
 * Between the watched process and the agent's attention: coalesce, then throttle.
 *
 * Every event a monitor emits costs a TURN — a model invocation with the whole session
 * context. Two failure modes follow directly, and this module is the answer to both:
 *
 *   1. One logical event arriving as several lines (a stack trace, a `git status` block)
 *      would wake the agent once per line. So lines within `windowMs` become ONE batch;
 *      the wake carries all of them.
 *   2. A filter that is too loose (`tail -f` piped raw, a poll printing every tick) would
 *      wake the agent forever, spending the session on nothing. So a monitor that exceeds
 *      `maxPerWindow` events in the sliding rate window is STOPPED, not silently dropped —
 *      the agent is told its filter was too loose, which is a fact it can act on. Dropping
 *      events instead would leave it believing a monitor is still watching correctly.
 *
 * WHY THIS IS NOT `plugins/monitor-stream.ts`'s `createRateGate`. That sibling guards the same
 * kind of stream with the opposite policy on purpose: a PLUGIN monitor drops the excess lines
 * and keeps running, because the user installed it to watch something indefinitely and no
 * turn is spent per line there that the agent asked for. An AGENT monitor is the agent's own
 * choice and each event buys a turn, so flooding is a mistake in the FILTER — dropping lines
 * would hide it behind a monitor that looks healthy, and the useful answer is to stop and say
 * so. Same problem, different owner, different verdict; neither generalises to the other.
 *
 * Timers are injected so a test drives the window and the rate limit deterministically instead
 * of sleeping through them.
 */
import type { MonitorEvent } from './contracts'

/** Lines arriving this close together belong to one notification. */
export const BATCH_WINDOW_MS = 200
/** Rate window and its allowance. Past this a monitor is stopped as too chatty. */
export const RATE_WINDOW_MS = 60_000
export const RATE_MAX_PER_WINDOW = 60

export interface BatchTimerHandle {
  unref?: () => void
}

export interface EventBatcherDeps {
  /** Deliver one coalesced batch (never empty). */
  onFlush: (events: MonitorEvent[]) => void
  /**
   * The monitor produced more than the allowance — the caller must end it. Carries the
   * still-pending events INSTEAD of flushing them, so the ending and the last lines can be
   * delivered as ONE notification: a monitor being stopped for chattiness is the last thing
   * that should cost two turns.
   */
  onRateLimited: (observed: number, pending: MonitorEvent[]) => void
  windowMs?: number
  rateWindowMs?: number
  maxPerWindow?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => BatchTimerHandle
  clearTimer?: (handle: BatchTimerHandle) => void
}

export interface EventBatcher {
  /** Queue one event. Returns false once the batcher is rate-limited or disposed. */
  push(text: string): boolean
  /** Deliver anything pending immediately (a monitor that just ended). */
  flushNow(): void
  /** Drop pending work and timers; further pushes are refused. */
  dispose(): void
}

/** Real timers behind the injectable `setTimer`/`clearTimer` seams. */
export const defaultSetTimer = (fn: () => void, ms: number): BatchTimerHandle =>
  setTimeout(fn, ms) as unknown as BatchTimerHandle
export const defaultClearTimer = (handle: BatchTimerHandle): void => {
  clearTimeout(handle as unknown as Parameters<typeof clearTimeout>[0])
}

export function createEventBatcher(deps: EventBatcherDeps): EventBatcher {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? defaultSetTimer
  const clearTimer = deps.clearTimer ?? defaultClearTimer
  const windowMs = deps.windowMs ?? BATCH_WINDOW_MS
  const rateWindowMs = deps.rateWindowMs ?? RATE_WINDOW_MS
  const maxPerWindow = deps.maxPerWindow ?? RATE_MAX_PER_WINDOW

  let pending: MonitorEvent[] = []
  let timer: BatchTimerHandle | null = null
  let stopped = false
  /** Timestamps of accepted events inside the rate window. */
  const recent: number[] = []

  const flush = () => {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
    if (pending.length === 0) return
    const batch = pending
    pending = []
    deps.onFlush(batch)
  }

  return {
    push(text) {
      if (stopped) return false
      const at = now()
      // Prune, then decide. The limit counts EVENTS, not batches: ten lines in one batch
      // still cost ten lines of the agent's attention, and a chatty monitor that happens to
      // arrive in bursts is exactly as expensive as one that dribbles.
      while (recent.length > 0 && at - (recent[0] as number) > rateWindowMs) recent.shift()
      recent.push(at)
      pending.push({ at, text })
      if (recent.length > maxPerWindow) {
        // Hand the pending lines over WITH the verdict — ending a monitor is the caller's
        // decision, and the last lines are usually the informative ones.
        const observed = recent.length
        stopped = true
        const drained = pending
        pending = []
        if (timer) {
          clearTimer(timer)
          timer = null
        }
        deps.onRateLimited(observed, drained)
        return false
      }
      if (!timer) {
        timer = setTimer(flush, windowMs)
        timer.unref?.()
      }
      return true
    },
    flushNow() {
      flush()
    },
    dispose() {
      stopped = true
      pending = []
      if (timer) {
        clearTimer(timer)
        timer = null
      }
    },
  }
}
