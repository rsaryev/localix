/**
 * Failure backoff for fires, doubling per consecutive failure and capped.
 *
 * A cron trigger's next slot comes round whatever the last fire did, so a `* * * * *` loop whose
 * provider connection was deleted fired every minute forever — measured at 30 fires in 30 ticks,
 * which is 1440 dead runs a day and, on a subsession target, 1440 real child sessions. The other
 * brakes cover causes that clear by themselves (a busy session, a rate-limit cooldown); a broken
 * provider is neither.
 *
 * BACKOFF, not pause: the cause is usually external and fixable, so the trigger comes back by
 * itself the moment a fire succeeds — no lifecycle state, nothing for the user to remember. The
 * first failure costs nothing at a one-minute cadence (the base is one slot), and the one-hour cap
 * makes a broken trigger cheap (~24 fires a day) while still picking up a fix the same hour.
 *
 * The streak is kept IN MEMORY by the engine, deliberately: a restart usually follows the operator
 * changing something, so re-arming at full cadence is the right bias, and a durable counter would
 * keep throttling a trigger whose cause was fixed during the downtime.
 */
import { backoffMs } from '../../lib/backoff'

const FIRE_BACKOFF = { baseMs: 60_000, maxMs: 60 * 60_000 }

export function fireBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures < 1) return 0
  return backoffMs(consecutiveFailures - 1, FIRE_BACKOFF)
}
