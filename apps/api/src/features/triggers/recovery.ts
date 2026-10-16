/**
 * What a boot does with a trigger the previous process left behind.
 *
 * Only two states are the dead process's own and cannot be believed:
 *
 *   - `firing` — the fire it started has no one left to settle it. Its due time was advanced
 *     BEFORE the fire (a cron's next slot, a delay's watchdog), so re-arming at the stored time is
 *     exactly one catch-up fire when that time has passed, never a replay;
 *   - `held` for `busy` — busy was that process's run. This one re-asks.
 *
 * A rate-limit hold is kept: its cooldown is a fact about the provider, not the process, and it
 * is persisted precisely so a restart does not fire into a quota that is still exhausted.
 *
 * A trigger whose kind or action this build no longer registers is ENDED rather than left armed:
 * nothing could ever fire it, and leaving it live would show a schedule that does not exist.
 *
 * A trigger of an `end`-on-restart kind was fed by the dead process itself — a live command, a
 * child process — so there is nothing left to resume. It ends with `restart`, silently: whatever
 * it was watching is shown as lost where it is listed, and nobody is woken to be told.
 */
import type { TriggerKind, TriggerRecord } from './contracts'
import type { TriggerPatch } from './repository'

export type Recovery = { patch: TriggerPatch } | { end: string } | null

export function recoverTrigger(
  trigger: TriggerRecord,
  known: { kinds: ReadonlyMap<string, TriggerKind>; actions: ReadonlySet<string> },
  nowIso: string,
): Recovery {
  const kind = known.kinds.get(trigger.kind)
  if (!kind || !known.actions.has(trigger.action)) {
    return { end: 'unsupported' }
  }
  if (kind.onRestart === 'end') return { end: 'restart' }
  if (trigger.state === 'firing' || (trigger.state === 'held' && trigger.holdReason === 'busy')) {
    return { patch: { state: 'armed', holdReason: null, updatedAt: nowIso } }
  }
  return null
}

/** Ended triggers are history, kept long enough to read what ended them. */
export const ENDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
