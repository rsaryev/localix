import type { NotificationEntry } from './types'
import { sameOrigin } from './origin'
import { eventNeedsAction } from './actionability'

/**
 * Max entries retained in the center. Beyond this the OLDEST are dropped — the
 * list is kept newest-first, so we trim from the tail.
 */
export const NOTIFICATIONS_CAP = 200
export const APPLICATION_COALESCE_MS = 5 * 60_000

/**
 * THE OPTIMISTIC HALF of the inbox's rules. The server journal (`apps/api/.../notifications/
 * projection.ts`) is the authority; these transitions only paint what an op will do until the
 * server's answer replaces them (`journal.ts`), so a fact raised while the API is unreachable is
 * still on screen.
 */

function isRepeatedApplicationEvent(
  existing: NotificationEntry,
  entry: NotificationEntry,
): boolean {
  // Text-coalescing is for anonymous events. A condition already knows exactly what it is about, and
  // two subjects failing the same way ("permission denied") are two facts, not one seen twice.
  if (entry.condition || existing.condition) return false
  // A row already settled is finished; a repeat after it is a new fact (the server's rule too).
  if (existing.resolvedAt != null) return false
  const lastSeen = existing.lastSeenAt ?? existing.ts
  return (
    entry.topic === 'application.notification' &&
    existing.topic === entry.topic &&
    entry.ts >= lastSeen &&
    entry.ts - lastSeen <= APPLICATION_COALESCE_MS &&
    existing.category === entry.category &&
    existing.severity === entry.severity &&
    existing.title === entry.title &&
    existing.message === entry.message &&
    sameOrigin(existing.origin, entry.origin)
  )
}

/** Prepend a new entry (newest-first) and cap the list, dropping the oldest. */
export function addEntry(
  list: readonly NotificationEntry[],
  entry: NotificationEntry,
  cap = NOTIFICATIONS_CAP,
): NotificationEntry[] {
  // Logical lifecycle notifications carry a stable domain dedupe key as their id.
  // Preserve the existing row (including its read state) when reconnect replay or
  // page reload delivers the same durable fact again.
  const sameIndex = list.findIndex((existing) => existing.id === entry.id)
  if (sameIndex >= 0) {
    const existing = list[sameIndex]!
    // A standing condition that was SETTLED and is now published again has come back: the file was
    // fixed, then broken the same way. Its key is derived from what is wrong, so it is the same id —
    // and keeping the old row would leave "Resolved" on a problem that is true again, silently. Only
    // conditions reopen; a replayed HITL request that was answered stays answered.
    if (
      existing.resolvedAt == null ||
      !existing.condition ||
      !entry.condition ||
      entry.resolvedAt
    ) {
      return list as NotificationEntry[]
    }
    // The row reopens as one fact seen again, not a new fact: a connection that dropped three times
    // this afternoon is one row saying ×3, not three pairs of "unavailable"/"restored".
    const reopened: NotificationEntry = {
      ...entry,
      occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
      firstSeenAt: existing.firstSeenAt ?? existing.ts,
      lastSeenAt: entry.ts,
    }
    return [reopened, ...list.slice(0, sameIndex), ...list.slice(sameIndex + 1)]
  }
  const repeatedIndex = list.findIndex((existing) => isRepeatedApplicationEvent(existing, entry))
  if (repeatedIndex >= 0) {
    const existing = list[repeatedIndex]!
    const merged: NotificationEntry = {
      ...existing,
      ...entry,
      id: existing.id,
      occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
      firstSeenAt: existing.firstSeenAt ?? existing.ts,
      lastSeenAt: entry.ts,
      read: existing.read && entry.read,
    }
    return trimToCap(
      [merged, ...list.slice(0, repeatedIndex), ...list.slice(repeatedIndex + 1)],
      cap,
    )
  }
  return trimToCap([entry, ...list], cap)
}

/**
 * Whether a row still stands for something open: work the person can do, or a problem that is still
 * true. Mirrors what "Clear history" keeps (`retainActionableEvents`).
 */
export function isPendingEntry(entry: NotificationEntry): boolean {
  return entry.resolvedAt == null && (entry.condition === true || eventNeedsAction(entry))
}

/**
 * Keep the list within `cap`, dropping the oldest SETTLED rows first.
 *
 * Trimming blindly from the tail let a burst of noise (a flapping connection, a run of completed
 * jobs) push out a question still waiting for an answer or a file that still does not validate —
 * the rows the journal exists to keep. Only when every row is pending does the oldest pending go.
 */
export function trimToCap(list: NotificationEntry[], cap = NOTIFICATIONS_CAP): NotificationEntry[] {
  let excess = list.length - cap
  if (excess <= 0) return list
  const dropped = new Set<NotificationEntry>()
  for (let index = list.length - 1; index >= 0 && excess > 0; index -= 1) {
    if (isPendingEntry(list[index]!)) continue
    dropped.add(list[index]!)
    excess -= 1
  }
  const kept = list.filter((entry) => !dropped.has(entry))
  return kept.length > cap ? kept.slice(0, cap) : kept
}

/** Mark a single entry read by id (no-op if absent or already read). */
export function markRead(list: readonly NotificationEntry[], id: string): NotificationEntry[] {
  let changed = false
  const next = list.map((n) => {
    if (n.id !== id || n.read) return n
    changed = true
    return { ...n, read: true }
  })
  return changed ? next : (list as NotificationEntry[])
}

/** Mark every unread entry read. */
export function markAllRead(list: readonly NotificationEntry[]): NotificationEntry[] {
  if (list.every((n) => n.read)) return list as NotificationEntry[]
  return list.map((n) => (n.read ? n : { ...n, read: true }))
}

/** Remove a single entry by id. */
export function removeEntry(list: readonly NotificationEntry[], id: string): NotificationEntry[] {
  const next = list.filter((n) => n.id !== id)
  return next.length === list.length ? (list as NotificationEntry[]) : next
}

/** Count of unread entries. */
export function unreadCount(list: readonly NotificationEntry[]): number {
  let n = 0
  for (const e of list) if (!e.read) n += 1
  return n
}

/**
 * Settle every entry under a condition prefix except the one still true.
 *
 * A standing condition ("this file has 2 problems") is republished with a key derived from what is
 * wrong, so fixing one of the two problems produces a NEW key while the old row stays in the list
 * asserting something that is no longer the case. Resolving by prefix is what keeps the centre
 * honest: the superseded rows settle, the current one stays live, and a condition that clears
 * entirely settles all of them.
 */
export function resolveByIdPrefix(
  list: readonly NotificationEntry[],
  prefix: string,
  keep: string | undefined,
  resolvedAt: number,
): NotificationEntry[] {
  return settleWhere(list, (id) => id !== keep && id.startsWith(prefix), resolvedAt)
}

/** Settle one row: nothing it offers can act any more (the server retires its actions the same way). */
export function settleEntry(
  list: readonly NotificationEntry[],
  id: string,
  resolvedAt: number,
): NotificationEntry[] {
  return settleWhere(list, (candidate) => candidate === id, resolvedAt)
}

function settleWhere(
  list: readonly NotificationEntry[],
  matches: (id: string) => boolean,
  resolvedAt: number,
): NotificationEntry[] {
  let changed = false
  const next = list.map((entry) => {
    if (entry.resolvedAt != null || !matches(entry.id)) return entry
    changed = true
    return {
      ...entry,
      resolvedAt,
      actions: entry.actions?.map((action) =>
        action.available ? { ...action, available: false } : action,
      ),
    }
  })
  return changed ? next : (list as NotificationEntry[])
}
