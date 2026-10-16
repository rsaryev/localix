import type { SessionSummary, StatBucket } from '../../shared/contracts'

/**
 * Heaviest sessions listed. Small on purpose: the point is the few that dominate, and on this
 * machine the top ten already account for 53% of every token measured.
 */
export const STATS_SESSION_LIMIT = 8

/**
 * The heaviest individual sessions in the window — see `ExternalAgentStats.topSessions`.
 *
 * Ranked on measured tokens only. A session whose provider reported none is not ranked at all rather
 * than ranked as a zero: it would sort to the bottom and read as "this run was free".
 */
export function heaviestSessions(rows: readonly SessionSummary[]): StatBucket[] {
  return rows
    .filter((row) => (row.usage?.totalTokens ?? 0) > 0)
    .sort((a, b) => (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0))
    .slice(0, STATS_SESSION_LIMIT)
    .map((row) => ({
      key: row.key,
      label: row.title?.trim() || row.nativeSessionId,
      sessions: 1,
      updatedAt: row.updatedAt,
      ...(row.usage ? { usage: row.usage } : {}),
    }))
}

/**
 * The sessions that delegated most — see `ExternalAgentStats.byParent`.
 *
 * `all` rather than the window's selection on purpose: children are hidden by default and are most
 * of what exists (1,283 of 1,535 here), so counting only what the filter kept would report a fan-out
 * of zero for every parent. The parent must still be one of the sessions being reported on, or the
 * axis would name rows the reader cannot reach from this screen.
 */
export function mostDelegating(
  selected: readonly SessionSummary[],
  all: readonly SessionSummary[],
): StatBucket[] {
  const children = new Map<string, number>()
  for (const row of all) {
    const parent = row.parentNativeSessionId
    if (!parent) continue
    // Keyed by provider AND id: a native id is only unique within its provider.
    const key = `${row.provider}:${parent}`
    children.set(key, (children.get(key) ?? 0) + 1)
  }
  if (children.size === 0) return []
  return selected
    .map((row) => ({ row, count: children.get(`${row.provider}:${row.nativeSessionId}`) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, STATS_SESSION_LIMIT)
    .map((entry) => ({
      key: entry.row.key,
      label: entry.row.title?.trim() || entry.row.nativeSessionId,
      sessions: entry.count,
      updatedAt: entry.row.updatedAt,
    }))
}

/**
 * Agents present in the selection but absent from the window.
 *
 * The count is ALL-TIME for that provider, not a windowed one — the whole point is what the window
 * left out — and `updatedAt` is the newest thing it did, which is what tells a reader how far back to
 * widen.
 */
export function providersOutsideWindow(
  selected: readonly SessionSummary[],
  inWindow: readonly SessionSummary[],
): StatBucket[] {
  const present = new Set(inWindow.map((row) => row.provider))
  const absent = new Map<string, { sessions: number; updatedAt: number }>()
  for (const row of selected) {
    if (present.has(row.provider)) continue
    const seen = absent.get(row.provider)
    if (seen) {
      seen.sessions += 1
      seen.updatedAt = Math.max(seen.updatedAt, row.updatedAt)
    } else absent.set(row.provider, { sessions: 1, updatedAt: row.updatedAt })
  }
  return [...absent.entries()]
    .map(([key, value]) => ({ key, sessions: value.sessions, updatedAt: value.updatedAt }))
    .sort((a, b) => b.sessions - a.sessions)
}
