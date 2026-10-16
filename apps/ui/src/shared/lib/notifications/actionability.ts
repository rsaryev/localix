import { notificationCommandAvailable, notificationCommandRevision } from './commandRegistry'
import type { NotificationEntry } from './types'

/** Whether an event still represents work the user can complete. */
export function eventNeedsAction(
  entry: NotificationEntry,
  commandRevision = notificationCommandRevision(),
): boolean {
  return (
    entry.resolvedAt == null &&
    (entry.actions?.some(
      (action) =>
        notificationCommandAvailable(action, commandRevision) &&
        (action.kind === 'callback' ||
          action.kind === 'invoke' ||
          (action.kind === 'navigate' && action.target?.focus === 'interaction')),
    ) ??
      false)
  )
}

/**
 * A standing condition that has not been settled — a file that still will not validate, a database
 * that is still unreachable. Distinct from `eventNeedsAction`, which asks whether a BUTTON is live:
 * a problem row can carry no action at all, and after a reload its callback actions are gone by
 * design (`overlay.ts`), yet the problem itself is every bit as true as before the reload.
 */
const isStandingCondition = (entry: NotificationEntry): boolean =>
  entry.resolvedAt == null && entry.condition === true

/**
 * Clear settled history without making pending human or recovery work disappear — nor a problem
 * that is still true. "Clear" means "put away what is finished"; a broken board file is not
 * finished, and deleting it because its Retry button did not survive a page reload would make the
 * durable record less durable than the failure it records.
 */
export function retainActionableEvents(
  entries: readonly NotificationEntry[],
  commandRevision = notificationCommandRevision(),
): NotificationEntry[] {
  const retained = entries.filter(
    (entry) => eventNeedsAction(entry, commandRevision) || isStandingCondition(entry),
  )
  return retained.length === entries.length ? (entries as NotificationEntry[]) : retained
}
