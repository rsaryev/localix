import type { QuotaReading, SessionSummary } from '../../shared/contracts'

/**
 * The account's CURRENT windows: the newest reading of EACH one any of its sessions recorded.
 *
 * Folded here rather than on a session because a quota is not a property of a session — every
 * session of one agent draws on the same windows, so an older session's percentage describes a
 * moment, not a state. Ordered by when the provider WROTE the reading, not by when the file was
 * touched: a transcript can be rewritten by a later append without the quota line changing.
 *
 * Keyed on the window's LENGTH, which is the correction this fold needed. `primary` is not a fixed
 * window — with two open, Codex puts the 5-hour one there and moves the weekly to `secondary` — so a
 * single "newest reading" flips between a 5-hour percentage and a weekly one depending on which
 * session wrote last, and presents them as the same quantity.
 */
export function newestQuotas(summaries: readonly SessionSummary[]): readonly QuotaReading[] {
  const byWindow = new Map<number, QuotaReading>()
  for (const summary of summaries) {
    for (const quota of summary.quotas ?? []) {
      const seen = byWindow.get(quota.windowMinutes)
      if (!seen || quota.observedAt > seen.observedAt) byWindow.set(quota.windowMinutes, quota)
    }
  }
  // Shortest window first: it is the one most likely to bind, and a stable order keeps the workspace
  // from reshuffling between scans.
  return [...byWindow.values()].sort((a, b) => a.windowMinutes - b.windowMinutes)
}
