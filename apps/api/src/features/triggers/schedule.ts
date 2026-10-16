/**
 * Cron evaluation, backed by `croner`, in an EXPLICIT IANA zone.
 *
 * The zone is stored with the trigger rather than read from the process at each evaluation. A cron
 * the user wrote as "9:00 on weekdays" means nine o'clock where they were when they wrote it; an
 * implicit process zone makes the same row fire at a different hour after the machine's zone
 * changes, and croner's own zone handling is what keeps a DST transition from skipping or doubling
 * a slot.
 */
import { Cron } from 'croner'

/** The zone this process runs in — what a new cron is interpreted in. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** True when `expr` is a valid 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  try {
    // No callback → croner only parses; paused so nothing is ever scheduled.
    new Cron(expr, { paused: true }).stop()
    return true
  } catch {
    return false
  }
}

/** The next slot strictly after `after` in `timeZone`, or null when there is none. */
export function nextCronSlot(expr: string, after: Date, timeZone: string): Date | null {
  try {
    const cron = new Cron(expr, { paused: true, timezone: timeZone })
    const next = cron.nextRun(after)
    cron.stop()
    return next
  } catch {
    return null
  }
}
