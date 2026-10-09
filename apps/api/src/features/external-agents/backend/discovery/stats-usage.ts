import type {
  SessionSummary,
  StatBucket,
  TokenUsage,
  ModelTokenUsage,
} from '../../shared/contracts'
import { addUsage, emptyUsage } from '../adapters/usage'

export function fold(
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

export interface WindowUsage {
  readonly totals: TokenUsage
  readonly byModel: readonly ModelTokenUsage[]
}

export function usageInWindow(row: SessionSummary, sinceDay: string): WindowUsage | undefined {
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

export function foldModels(rows: readonly SessionSummary[], sinceDay: string): StatBucket[] {
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
