import type { SessionSummary, StatBucket, TokenUsage } from '../../shared/contracts'
import { addUsage, emptyUsage } from '../adapters/usage'
import { usageInWindow } from './stats-usage'

export const DAY_MS = 86_400_000

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

export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Fold the window into daily or weekly buckets, retaining empty periods. */
export function buildTrend(
  rows: readonly SessionSummary[],
  days: number,
  now: number,
  sinceDay: string,
) {
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

  return { byDay, bucketDays }
}
