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
import type {
  ExternalAgentStats,
  ModelTokenUsage,
  SessionSummary,
  StatBucket,
  StatsQuery,
  TokenUsage,
} from '../../shared/contracts'
import { addUsage, emptyUsage } from '../adapters/usage'

export type { ExternalAgentStats, StatBucket, StatsQuery }
export { DEFAULT_STATS_DAYS, MAX_STATS_DAYS }

/**
 * Projects shown; the tail is folded away rather than truncated silently.
 *
 * Stays here rather than in the contracts: it is a choice this fold makes about how much of the
 * tail is worth sending, not a bound any caller may ask past.
 */
export const STATS_PROJECT_LIMIT = 12

/**
 * Heaviest sessions listed. Small on purpose: the point is the few that dominate, and on this
 * machine the top ten already account for 53% of every token measured.
 */
export const STATS_SESSION_LIMIT = 8

const DAY_MS = 86_400_000

/**
 * Days per trend bucket for a window of `days`.
 *
 * A year drawn as 365 bars is not a chart: at any real panel width each bar is under a pixel, so
 * the shape it is meant to show disappears into noise. Above a quarter the trend switches to weeks,
 * which keeps the bar count in the range a reader can actually resolve (52 for a year).
 */
export function bucketDaysFor(days: number): number {
  return days > 90 ? 7 : 1
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

function fold(
  rows: readonly SessionSummary[],
  keyOf: (row: SessionSummary) => string,
  sinceDay: string,
): StatBucket[] {
  const acc = new Map<
    string,
    {
      sessions: number
      messages: number
      known: number
      usage: TokenUsage
      usageKnown: number
      updatedAt: number
    }
  >()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = acc.get(key) ?? {
      sessions: 0,
      messages: 0,
      known: 0,
      usage: emptyUsage(),
      usageKnown: 0,
      updatedAt: 0,
    }
    bucket.sessions += 1
    if (row.messageCount !== undefined) {
      bucket.messages += row.messageCount
      bucket.known += 1
    }
    const usage = usageInWindow(row, sinceDay)
    if (usage) {
      bucket.usage = addUsage(bucket.usage, usage.totals)
      bucket.usageKnown += 1
    }
    if (row.updatedAt > bucket.updatedAt) bucket.updatedAt = row.updatedAt
    acc.set(key, bucket)
  }
  return [...acc.entries()]
    .map(([key, value]) => ({
      key,
      sessions: value.sessions,
      updatedAt: value.updatedAt,
      ...(value.known > 0 ? { messages: value.messages } : {}),
      ...(value.usageKnown > 0 ? { usage: value.usage } : {}),
    }))
    .sort(
      (a, b) =>
        (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0) ||
        b.sessions - a.sessions ||
        b.updatedAt - a.updatedAt,
    )
}

interface WindowUsage {
  readonly totals: TokenUsage
  readonly byModel: readonly ModelTokenUsage[]
}

function usageInWindow(row: SessionSummary, sinceDay: string): WindowUsage | undefined {
  if (!row.usage) return undefined
  let totals = emptyUsage()
  const models = new Map<string, TokenUsage>()
  for (const day of row.usage.byDay) {
    if (day.day < sinceDay) continue
    totals = addUsage(totals, day)
    for (const model of day.byModel) {
      models.set(model.model, addUsage(models.get(model.model) ?? emptyUsage(), model))
    }
  }
  if (totals.totalTokens <= 0 && totals.requests <= 0) return undefined
  return {
    totals,
    byModel: [...models.entries()].map(([model, usage]) => ({ model, ...usage })),
  }
}

function foldModels(rows: readonly SessionSummary[], sinceDay: string): StatBucket[] {
  const buckets = new Map<string, { sessions: number; usage: TokenUsage; updatedAt: number }>()
  for (const row of rows) {
    const usage = usageInWindow(row, sinceDay)
    if (!usage) {
      /**
       * A session the provider measured nothing for still ran on a model, where the provider records
       * one. Without this the axis was derived from token usage alone, so GitHub Copilot's 34 sessions
       * and 5,541 messages here contributed nothing to it — and the tile above read "0 models", which
       * says something about models rather than about measurement.
       *
       * It contributes a SESSION and no tokens, which is what is known.
       */
      if (!row.model) continue
      const bucket = buckets.get(row.model) ?? { sessions: 0, usage: emptyUsage(), updatedAt: 0 }
      bucket.sessions += 1
      bucket.updatedAt = Math.max(bucket.updatedAt, row.updatedAt)
      buckets.set(row.model, bucket)
      continue
    }
    for (const model of usage.byModel) {
      const bucket = buckets.get(model.model) ?? {
        sessions: 0,
        usage: emptyUsage(),
        updatedAt: 0,
      }
      bucket.sessions += 1
      bucket.usage = addUsage(bucket.usage, model)
      bucket.updatedAt = Math.max(bucket.updatedAt, row.updatedAt)
      buckets.set(model.model, bucket)
    }
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort(
      (a, b) =>
        b.usage.totalTokens - a.usage.totalTokens ||
        b.sessions - a.sessions ||
        a.key.localeCompare(b.key),
    )
}

/**
 * Fold summaries into the statistics surface.
 *
 * `now` is injected so the day buckets are testable; the window is [now - days, now].
 */
/**
 * The heaviest individual sessions in the window — see `ExternalAgentStats.topSessions`.
 *
 * Ranked on measured tokens only. A session whose provider reported none is not ranked at all rather
 * than ranked as a zero: it would sort to the bottom and read as "this run was free".
 */
function heaviestSessions(rows: readonly SessionSummary[]): StatBucket[] {
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
function mostDelegating(
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
function providersOutsideWindow(
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

  // Every bucket in the window is present, including the empty ones: a trend drawn only from the
  // periods that happened to have activity compresses a quiet stretch into a dense-looking line.
  const bucketDays = bucketDaysFor(days)
  const bucketCount = Math.ceil(days / bucketDays)
  // A bucket is named by its FIRST day, so a weekly bar reads as "the week starting …" rather than
  // as a day that happens to have absorbed six others.
  const startOf = (index: number) => now - (bucketCount - 1 - index) * bucketDays * DAY_MS
  const bucketOf = (at: number) => {
    const elapsed = now - at
    return Math.max(0, bucketCount - 1 - Math.floor(elapsed / (bucketDays * DAY_MS)))
  }
  const folded = new Map<
    number,
    {
      sessions: number
      messages: number
      known: number
      usage: TokenUsage
      usageKnown: number
    }
  >()
  for (const row of rows) {
    const index = bucketOf(row.updatedAt)
    const bucket = folded.get(index) ?? {
      sessions: 0,
      messages: 0,
      known: 0,
      usage: emptyUsage(),
      usageKnown: 0,
    }
    bucket.sessions += 1
    if (row.messageCount !== undefined) {
      bucket.messages += row.messageCount
      bucket.known += 1
    }
    folded.set(index, bucket)
    const usage = usageInWindow(row, sinceDay)
    if (!usage) continue
    for (const daily of row.usage?.byDay ?? []) {
      if (daily.day < sinceDay) continue
      const usageIndex = bucketOf(Date.parse(`${daily.day}T00:00:00.000Z`))
      const usageBucket = folded.get(usageIndex) ?? {
        sessions: 0,
        messages: 0,
        known: 0,
        usage: emptyUsage(),
        usageKnown: 0,
      }
      usageBucket.usage = addUsage(usageBucket.usage, daily)
      usageBucket.usageKnown += 1
      folded.set(usageIndex, usageBucket)
    }
  }
  const byDay: StatBucket[] = []
  for (let index = 0; index < bucketCount; index += 1) {
    const hit = folded.get(index)
    byDay.push({
      key: dayKey(startOf(index)),
      sessions: hit?.sessions ?? 0,
      updatedAt: 0,
      ...(hit && hit.known > 0 ? { messages: hit.messages } : {}),
      ...(hit && hit.usageKnown > 0 ? { usage: hit.usage } : {}),
    })
  }

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
