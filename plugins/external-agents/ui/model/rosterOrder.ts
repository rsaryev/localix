/**
 * Roster ordering and page accumulation.
 *
 * The list is ONE list: live delegations and sessions discovered on disk are distinguished by
 * their state badge, not by living on separate screens. Live rows sort first because they are the
 * ones a user can still act on; everything else falls back to `updatedAt` descending.
 */
import { isLive } from './stateTone'
import type { RosterRow } from './types'

/**
 * Sort a page-accumulated roster.
 *
 * WHY sort on the client at all when paging is server-side: the sort below is a NO-OP whenever the
 * backend already returns the documented order, and it is what keeps the invariant true if it does
 * not. It is a total order (the `key` tiebreak) so the sort is stable across re-renders and rows
 * cannot swap places under the user's cursor between two identical responses.
 *
 * It does NOT reorder across the paging boundary in any way that breaks paging: `offset` addresses
 * the SERVER's sequence, which this function never mutates — only the displayed order.
 */
export function sortRoster(rows: readonly RosterRow[]): RosterRow[] {
  return [...rows].sort((a, b) => {
    const liveDelta = Number(isLive(b)) - Number(isLive(a))
    if (liveDelta !== 0) return liveDelta
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/**
 * Append a page, dropping keys already present.
 *
 * Dedup is mandatory rather than defensive: rows are discovered from a live filesystem, so a
 * session touched between two page requests shifts the server window and the same key can arrive
 * twice. Two React children with one key is a hard rendering bug, and in a virtualized list it
 * shows up as a row that silently never renders.
 */
export function appendPage(
  existing: readonly RosterRow[],
  page: readonly RosterRow[],
): RosterRow[] {
  const seen = new Set(existing.map((row) => row.key))
  const merged = [...existing]
  for (const row of page) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    merged.push(row)
  }
  return sortRoster(merged)
}
