import type { NotificationEntry, NotificationSeverity } from './types'

/** Changes when a coalesced occurrence updates the same retained row id. */
export function eventSignalKey(entry: NotificationEntry | undefined): string | undefined {
  return entry
    ? `${entry.id}:${entry.lastSeenAt ?? entry.ts}:${entry.occurrenceCount ?? 1}`
    : undefined
}

/** Highest visual priority among unread events for the always-visible status indicator. */
export function highestUnreadSeverity(
  entries: readonly NotificationEntry[],
): NotificationSeverity | null {
  const unread = entries.filter((entry) => !entry.read)
  if (unread.some((entry) => entry.severity === 'error')) return 'error'
  if (unread.some((entry) => entry.severity === 'warning')) return 'warning'
  if (unread.some((entry) => entry.severity === 'success')) return 'success'
  return unread.length > 0 ? 'info' : null
}
