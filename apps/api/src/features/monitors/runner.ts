/**
 * ONE monitor's lifetime: source → batcher → exactly one ending.
 *
 * Split out of the service because the service's job is the REGISTRY (who owns what, caps,
 * ids, snapshots) while this is a state machine with one hard invariant: a monitor ends
 * exactly once, and whatever ended it wins. Four things race for that ending — the source
 * finishing on its own, the timeout, a stop from the user or the model, and the rate limiter —
 * and every one of them must also flush the events already batched, or the last lines before
 * the ending (usually the informative ones) are dropped.
 *
 * The `unref`'d timeout matters for the same reason `features/sleep` unrefs its timer: a
 * pending watch must never be the reason the process refuses to exit.
 */
import {
  createEventBatcher,
  defaultClearTimer,
  defaultSetTimer,
  type BatchTimerHandle,
  type EventBatcher,
} from './batch'
import type { MonitorEndReason, MonitorEvent } from './contracts'
import type { MonitorSource } from './sources'

export interface MonitorRun {
  /** End it now with an explicit verdict. Idempotent; later calls are ignored. */
  stop(reason: MonitorEndReason, detail?: string): void
}

export interface MonitorRunDeps {
  source: MonitorSource
  /** Deadline in ms, or `null` for a persistent watch. */
  timeoutMs: number | null
  /** A coalesced batch of events — never empty, never after the ending. */
  onEvents: (events: MonitorEvent[]) => void
  /**
   * The single ending, carrying the events that were still batched when it happened. They
   * ride the ending rather than a wake of their own: the last lines and the reason are one
   * fact ("test: failed … then the monitor exited"), and splitting them costs a whole extra
   * turn for nothing.
   */
  onEnd: (reason: MonitorEndReason, detail: string | undefined, finalEvents: MonitorEvent[]) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => BatchTimerHandle
  clearTimer?: (handle: BatchTimerHandle) => void
  /** Batcher tuning (tests drive the window; production takes the defaults). */
  batchWindowMs?: number
  rateWindowMs?: number
  maxPerWindow?: number
}

export function startMonitorRun(deps: MonitorRunDeps): MonitorRun {
  const setTimer = deps.setTimer ?? defaultSetTimer
  const clearTimer = deps.clearTimer ?? defaultClearTimer
  let ended = false
  /** Set before the last flush, so those events join the ending instead of waking on their own. */
  let ending = false
  let final: MonitorEvent[] = []
  let deadline: BatchTimerHandle | null = null
  let batcher: EventBatcher | null = null

  const end = (reason: MonitorEndReason, detail?: string) => {
    if (ended) return
    ended = true
    ending = true
    if (deadline) {
      clearTimer(deadline)
      deadline = null
    }
    batcher?.flushNow()
    batcher?.dispose()
    deps.source.close()
    const carried = final
    final = []
    deps.onEnd(reason, detail, carried)
  }

  batcher = createEventBatcher({
    onFlush: (events) => {
      if (ending) {
        final.push(...events)
        return
      }
      deps.onEvents(events)
    },
    onRateLimited: (observed, pending) => {
      final.push(...pending)
      end(
        'rate-limited',
        `${observed} events in the rate window — the filter is too loose. Restart with a narrower one (match the lines you would ACT on, including failures).`,
      )
    },
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.setTimer ? { setTimer: deps.setTimer } : {}),
    ...(deps.clearTimer ? { clearTimer: deps.clearTimer } : {}),
    ...(deps.batchWindowMs !== undefined ? { windowMs: deps.batchWindowMs } : {}),
    ...(deps.rateWindowMs !== undefined ? { rateWindowMs: deps.rateWindowMs } : {}),
    ...(deps.maxPerWindow !== undefined ? { maxPerWindow: deps.maxPerWindow } : {}),
  })

  deps.source.onEvent((text) => {
    batcher?.push(text)
  })
  void deps.source.exited.then((exit) => end(exit.reason, exit.detail))

  if (deps.timeoutMs !== null) {
    deadline = setTimer(
      () => end('timeout', `no ending within ${Math.round(deps.timeoutMs! / 1000)}s`),
      deps.timeoutMs,
    )
    deadline.unref?.()
  }

  deps.source.start()

  return {
    stop(reason, detail) {
      end(reason, detail)
    },
  }
}
