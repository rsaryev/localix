// Per-connection SQL query history, persisted in localStorage. The ordering
// primitive `promoteHistory` is pure + unit-tested; the load/save wrappers add the
// storage boundary. Most-recent is index 0; exact duplicates float up, capped.
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

export interface SqlHistoryEntry {
  sql: string
  at: number
  /** Pinned (favorited) entries sort to the top and survive the cap. */
  pinned?: boolean
}

export const SQL_HISTORY_CAP = 50

const keyFor = (connectionId: string) => `localix.db.history.${connectionId}`

/**
 * New list with `entry` moved to the front, de-duplicated by SQL text, capped. Pure.
 * Pinned entries are never evicted by the cap (only the unpinned tail is trimmed) and a
 * re-run keeps a query's existing pinned state.
 */
export function promoteHistory(
  list: readonly SqlHistoryEntry[],
  entry: SqlHistoryEntry,
  cap = SQL_HISTORY_CAP,
): SqlHistoryEntry[] {
  const sql = entry.sql.trim()
  if (!sql) return [...list]
  const existing = list.find((e) => e.sql === sql)
  const next = [
    { sql, at: entry.at, pinned: existing?.pinned },
    ...list.filter((e) => e.sql !== sql),
  ]
  if (next.length <= cap) return next
  let budget = Math.max(0, cap - next.filter((e) => e.pinned).length)
  return next.filter((e) => {
    if (e.pinned) return true
    if (budget > 0) {
      budget--
      return true
    }
    return false
  })
}

/** Flip the pinned flag on the entry matching `sql`. Pure. */
export function togglePin(list: readonly SqlHistoryEntry[], sql: string): SqlHistoryEntry[] {
  return list.map((e) => (e.sql === sql ? { ...e, pinned: !e.pinned } : e))
}

/** Clear history but KEEP pinned favorites. Pure. */
export function clearHistory(list: readonly SqlHistoryEntry[]): SqlHistoryEntry[] {
  return list.filter((e) => e.pinned)
}

/**
 * Merge a pre-clear snapshot back into the CURRENT list — the undo half of
 * {@link clearHistory}. A merge rather than an assignment because time passes between the
 * clear and the undo: a query run in between must survive the restore, and a pin toggled in
 * between must not be reverted. The live entry therefore wins on every field; the snapshot
 * only re-adds statements that are gone. Ordering and the cap come from the same
 * {@link promoteHistory} rules the recorder uses, so an undo cannot produce a list the
 * recorder could not have produced. Pure.
 */
export function restoreHistory(
  current: readonly SqlHistoryEntry[],
  snapshot: readonly SqlHistoryEntry[],
  cap = SQL_HISTORY_CAP,
): SqlHistoryEntry[] {
  const live = new Set(current.map((entry) => entry.sql))
  // Oldest-first, so each promote puts a newer statement in front of an older one.
  const missing = [...snapshot].filter((entry) => !live.has(entry.sql)).sort((a, b) => a.at - b.at)
  let next = [...current]
  for (const entry of missing) {
    next = promoteHistory(next, entry, cap)
    // `promoteHistory` deliberately inherits the pinned flag from the EXISTING entry, and a
    // restored statement has none — carry the snapshot's own pin instead of dropping it.
    if (entry.pinned) next = next.map((e) => (e.sql === entry.sql ? { ...e, pinned: true } : e))
  }
  return sortHistory(next)
}

/** Display order: pinned first, then by recency. Pure, stable. */
export function sortHistory(list: readonly SqlHistoryEntry[]): SqlHistoryEntry[] {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
}

export function loadHistory(connectionId: string): SqlHistoryEntry[] {
  const raw = loadJSON<SqlHistoryEntry[]>(keyFor(connectionId))
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (e): e is SqlHistoryEntry => !!e && typeof e.sql === 'string' && typeof e.at === 'number',
    )
    .slice(0, SQL_HISTORY_CAP)
}

export function saveHistory(connectionId: string, list: SqlHistoryEntry[]): void {
  saveJSON(keyFor(connectionId), list)
}
