/**
 * One deadline per trigger, on the runtime's partitioned event loop.
 *
 * The loop engine this replaces ran one global tick that re-read every loop, slept at most 30s
 * because a new loop did not poke it, and re-checked a busy-held loop every second. A deadline per
 * trigger answers all three: arming or rescheduling sets that trigger's deadline directly, nothing
 * wakes for a trigger that is not due, and a trigger held for a busy session has NO deadline — the
 * session going idle is what re-evaluates it (`TriggerEngine.poke`).
 *
 * Reused rather than written: the event loop already owns `scheduleAt` (with the 2^31 ms clamp and
 * `unref`) and serial dispatch per key, which is the wake queue's own scheduler.
 */
import { createPartitionedEventLoop } from '../../lib/partitioned-event-loop'

export interface TriggerTimers {
  scheduleAt(id: string, deadlineMs: number): void
  cancel(id: string): void
  close(): Promise<void>
}

export function createTriggerTimers(
  evaluate: (id: string) => Promise<void>,
  onError: (error: unknown) => void = (error) =>
    console.warn('[triggers] evaluation failed', error),
): TriggerTimers {
  const loop = createPartitionedEventLoop<string>({ dispatch: evaluate, onError })
  return {
    scheduleAt: (id, deadlineMs) => loop.scheduleAt(id, deadlineMs),
    cancel: (id) => loop.cancel(id),
    close: () => loop.close(),
  }
}
