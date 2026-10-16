import type { ChatUsagePayload } from './chat-stream-types'

const SUMMED_USAGE_KEYS = [
  'totalTokens',
  'totalCost',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'cacheWrite1hTokens',
  'reasoningTokens',
] as const satisfies readonly (keyof ChatUsagePayload)[]

type SummedUsageKey = (typeof SUMMED_USAGE_KEYS)[number]

function accountingNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function usageNumber(
  usage: ChatUsagePayload | null | undefined,
  key: SummedUsageKey,
): number | undefined {
  if (!usage) return undefined
  if (key !== 'totalTokens') return accountingNumber(usage[key])
  const total = accountingNumber(usage.totalTokens)
  if (total !== undefined) return total
  const input = accountingNumber(usage.inputTokens)
  const output = accountingNumber(usage.outputTokens)
  return input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined
}

/** Mutable fold state for hot paths that already walk a message list once. */
export interface UsageAccumulator {
  count: number
  totals: Partial<Record<SummedUsageKey, number>>
  costSources: Set<NonNullable<ChatUsagePayload['costSource']>>
}

export function createUsageAccumulator(): UsageAccumulator {
  return { count: 0, totals: {}, costSources: new Set() }
}

/** A payload is accounting-bearing even when an adapter omitted totalTokens. */
export function hasRecordedUsage(
  usage: ChatUsagePayload | null | undefined,
): usage is ChatUsagePayload {
  if (!usage) return false
  return SUMMED_USAGE_KEYS.some((key) => {
    const value = accountingNumber(usage[key])
    return value !== undefined && value > 0
  })
}

export function accumulateUsage(
  accumulator: UsageAccumulator,
  usage: ChatUsagePayload | null | undefined,
): void {
  if (!hasRecordedUsage(usage)) return
  accumulator.count += 1
  for (const key of SUMMED_USAGE_KEYS) {
    const value = usageNumber(usage, key)
    if (value !== undefined) accumulator.totals[key] = (accumulator.totals[key] ?? 0) + value
  }
  if ((accountingNumber(usage.totalCost) ?? 0) > 0 && usage.costSource) {
    accumulator.costSources.add(usage.costSource)
  }
}

function summaryCostSource(
  sources: ReadonlySet<NonNullable<ChatUsagePayload['costSource']>>,
): ChatUsagePayload['costSource'] {
  if (sources.size === 0) return undefined
  if (sources.size === 1) return sources.values().next().value
  // A mixed session must never claim the whole amount is provider-reported actual
  // or subscription-metered. "estimated" is the conservative existing domain label.
  return 'estimated'
}

export function finishUsageAccumulator(
  accumulator: UsageAccumulator,
): ChatUsagePayload | undefined {
  if (accumulator.count === 0) return undefined
  return {
    ...accumulator.totals,
    costSource: summaryCostSource(accumulator.costSources),
    isSummary: true,
  }
}

/** Canonical session roll-up used by every UI surface. */
export function combineUsage(
  values: readonly (ChatUsagePayload | null | undefined)[],
): ChatUsagePayload | undefined {
  const accumulator = createUsageAccumulator()
  for (const usage of values) accumulateUsage(accumulator, usage)
  return finishUsageAccumulator(accumulator)
}

/**
 * Replace one turn inside an already aggregated session summary. Thin clients
 * hydrate the all-history summary but receive live updates only for their loaded
 * tail; subtracting the old payload and adding the new one keeps numeric totals
 * authoritative without rescanning (or downloading) the full transcript.
 */
export function replaceUsageInSummary(
  summary: ChatUsagePayload | null | undefined,
  previous: ChatUsagePayload | null | undefined,
  next: ChatUsagePayload | null | undefined,
): ChatUsagePayload | undefined {
  if (!summary) return next ? combineUsage([next]) : undefined
  const out: ChatUsagePayload = { ...summary, isSummary: true }
  for (const key of SUMMED_USAGE_KEYS) {
    const oldValue = usageNumber(previous, key) ?? 0
    const newValue = usageNumber(next, key) ?? 0
    const value = Math.max(0, (accountingNumber(summary[key]) ?? 0) - oldValue + newValue)
    if (value > 0 || summary[key] !== undefined || newValue > 0) out[key] = value
    else delete out[key]
  }
  const oldHasCost = (previous?.totalCost ?? 0) > 0
  const newHasCost = (next?.totalCost ?? 0) > 0
  if (!oldHasCost && newHasCost && !summary.costSource) out.costSource = next?.costSource
  else if (newHasCost && next?.costSource && summary.costSource !== next.costSource)
    out.costSource = 'estimated'
  return hasRecordedUsage(out) ? out : undefined
}

/** Cache-hit percentage. inputTokens already includes the cached subset. */
export function cacheHitRate(
  cacheReadTokens: number | undefined,
  inputTokens: number | undefined,
): number | null {
  if (inputTokens === undefined || inputTokens <= 0 || cacheReadTokens === undefined) return null
  return Math.round((cacheReadTokens / inputTokens) * 100)
}

/** Input tokens that were neither read from nor written to the prompt cache. */
export function uncachedInputTokens(
  inputTokens: number | undefined,
  cacheReadTokens: number | undefined,
  cacheWriteTokens = 0,
): number | undefined {
  if (inputTokens === undefined || cacheReadTokens === undefined) return undefined
  return Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
}
