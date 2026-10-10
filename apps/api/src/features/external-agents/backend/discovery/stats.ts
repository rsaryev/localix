/**
 * The FOLD that produces the statistics surface. The SHAPE it produces — `ExternalAgentStats`,
 * `StatBucket`, `StatsQuery` — is a wire contract and lives in `shared/contracts.ts`, alongside the
 * bounds the request schemas validate against.
 *
 * Computed from `SessionSummary` rows the index cache holds, never by re-reading transcripts: the
 * summaries are the cheap half of the adapter contract (`listSources` + a bounded head/tail parse),
 * and a statistics screen that re-parsed 700 files would be the one surface nobody could afford to
 * open. Everything here is therefore a fold over data the roster already paid for.
 */

import { DEFAULT_STATS_DAYS, MAX_STATS_DAYS } from '../../shared/contracts'
import { sessionUsedModel } from '../../shared/contracts'
import type { ExternalAgentStats, SessionSummary, StatsQuery } from '../../shared/contracts'
import { addUsage, emptyUsage } from '../adapters/usage'
import { fold, foldModels, usageInWindow, type WindowUsage } from './stats-usage'
import { heaviestSessions, mostDelegating, providersOutsideWindow } from './stats-rankings'
import { DAY_MS, dayKey, buildTrend } from './stats-trend'

export { STATS_SESSION_LIMIT } from './stats-rankings'

export type { ExternalAgentStats, StatsQuery }
export { DEFAULT_STATS_DAYS, MAX_STATS_DAYS }

/**
 * Projects shown; the tail is folded away rather than truncated silently.
 *
 * Stays here rather than in the contracts: it is a choice this fold makes about how much of the
 * tail is worth sending, not a bound any caller may ask past.
 */
export const STATS_PROJECT_LIMIT = 12

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

/**
 * Fold summaries into the statistics surface.
 *
 * `now` is injected so the day buckets are testable; the window is [now - days, now].
 */
export function computeStats(
  summaries: readonly SessionSummary[],
  query: StatsQuery,
  now: number,
): ExternalAgentStats {
  const days = Math.min(Math.max(1, query.days ?? DEFAULT_STATS_DAYS), MAX_STATS_DAYS)
  const since = now - days * DAY_MS
  const sinceDay = dayKey(since)

  // Sub-agent transcripts outnumber their parents several to one on a real machine, so counting
  // them by default would report a session volume nobody recognises as their own.
  const topLevel = query.includeChildren
    ? summaries
    : summaries.filter((row) => !row.parentNativeSessionId)
  const allowed = query.providers?.length ? new Set(query.providers) : null
  const byProvider0 = allowed ? topLevel.filter((row) => allowed.has(row.provider)) : topLevel
  // Same shape as the roster's: a prefix, so a project bar selects its own subtree too.
  const byCwd = query.cwdPrefix
    ? byProvider0.filter((row) => row.cwd?.startsWith(query.cwdPrefix as string))
    : byProvider0
  // The roster runs the same predicate over the same field, so a bar and the list it drills into
  // cannot report different counts.
  const selected = query.model
    ? byCwd.filter((row) => sessionUsedModel(row, query.model as string))
    : byCwd

  // THE window. Every figure below folds over it, so the range control means one thing across the
  // whole screen. It used to scope only the trend and one tile while the distributions answered for
  // all time — which put "61 sessions" beside bars summing to 382, with nothing to explain the gap.
  const rows = selected.filter((row) => row.updatedAt >= since)
  // The agent axis is the exception, because it is the drill CONTROL rather than a result: folding
  // it over `rows` collapses the chart to a single full-width bar the instant an agent is picked,
  // leaving nothing to pick next and no comparison left to read.
  const perAgent = topLevel.filter((row) => row.updatedAt >= since)

  // Providers with history that the window excludes ENTIRELY. Folded from `selected` rather than
  // `topLevel` so it obeys the provider filter: once a caller has narrowed to one agent, the others
  // having older history is not the question asked.
  const outsideRange = providersOutsideWindow(selected, rows)

  const durations = rows
    .filter((row) => row.startedAt !== undefined && row.updatedAt > row.startedAt)
    .map((row) => row.updatedAt - (row.startedAt as number))

  const { byDay, bucketDays } = buildTrend(rows, days, now, sinceDay)

  // The span reads over ALL of `selected`, not the window, so it answers "how far back is there
  // anything here" — the question a window-scoped span could only answer with the window.
  const stamps = selected.map((row) => row.updatedAt)
  const byProject = fold(rows, (row) => row.cwd ?? 'no working directory recorded', sinceDay)
  const measured = rows
    .map((row) => usageInWindow(row, sinceDay))
    .filter((usage): usage is WindowUsage => usage !== undefined)
  const usage =
    measured.length > 0
      ? measured.reduce((total, value) => addUsage(total, value.totals), emptyUsage())
      : undefined
  return {
    sessions: rows.length,
    ...(rows.some((row) => row.messageCount !== undefined)
      ? { messages: rows.reduce((sum, row) => sum + (row.messageCount ?? 0), 0) }
      : {}),
    ...(usage ? { usage } : {}),
    usageSessions: measured.length,
    projects: byProject.length,
    firstAt:
      stamps.length > 0
        ? Math.min(...selected.map((row) => row.startedAt ?? row.updatedAt))
        : undefined,
    lastAt: stamps.length > 0 ? Math.max(...stamps) : undefined,
    medianDurationMs: median(durations),
    byProvider: fold(perAgent, (row) => row.provider, sinceDay),
    byProject: byProject.slice(0, STATS_PROJECT_LIMIT),
    byModel: foldModels(rows, sinceDay),
    topSessions: heaviestSessions(rows),
    byParent: mostDelegating(rows, summaries),
    outsideRange,
    // `byDay` already carries every bucket in the window, empty ones included, so this is a count of
    // the ones that are not.
    activeDays: byDay.filter((bucket) => bucket.sessions > 0).length,
    byDay,
    bucketDays,
  }
}
