import type {
  DailyTokenUsage,
  ModelTokenUsage,
  SessionTokenUsage,
  TokenUsage,
} from '../../shared/contracts'

export interface TokenSample {
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly cacheWriteTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
  readonly totalTokens?: number
  /** Codex/Gemini report cache reads as a subset of input; Claude/opencode do not. */
  readonly inputIncludesCached?: boolean
  /** Gemini/opencode report thinking beside output; Codex includes it in output already. */
  readonly reasoningIncludedInOutput?: boolean
}

function count(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    requests: 0,
  }
}

/** Normalize the four provider vocabularies into additive counters. */
export function normalizeTokenSample(sample: TokenSample, requests = 1): TokenUsage {
  const rawInput = count(sample.inputTokens)
  const cachedInputTokens = count(sample.cachedInputTokens)
  const cacheWriteTokens = count(sample.cacheWriteTokens)
  const rawOutput = count(sample.outputTokens)
  const rawReasoning = count(sample.reasoningTokens)
  const outputTokens =
    sample.reasoningIncludedInOutput === false ? rawOutput + rawReasoning : rawOutput
  const reasoningTokens = Math.min(outputTokens, rawReasoning)
  const inputTokens = sample.inputIncludesCached
    ? Math.max(0, rawInput - cachedInputTokens)
    : rawInput
  const additiveTotal = inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens
  const reportedTotal = count(sample.totalTokens)
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    // A provider total wins when present; the additive fallback keeps older record shapes useful.
    totalTokens: reportedTotal || additiveTotal,
    requests: Math.max(0, Math.round(requests)),
  }
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    requests: left.requests + right.requests,
  }
}

/** Cumulative-provider delta. A counter reset starts a new additive segment. */
export function usageDelta(current: TokenUsage, previous: TokenUsage | undefined): TokenUsage {
  if (!previous || current.totalTokens < previous.totalTokens) return current
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    cacheWriteTokens: Math.max(0, current.cacheWriteTokens - previous.cacheWriteTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningTokens: Math.max(0, current.reasoningTokens - previous.reasoningTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    // A flat cumulative row is not another request. Codex logs can repeat `last_token_usage` while
    // the cumulative total stays fixed; summing `last` would double-charge it.
    requests: current.totalTokens > previous.totalTokens ? 1 : 0,
  }
}

function dayOf(timestamp: number | undefined): string {
  const date =
    timestamp !== undefined && Number.isFinite(timestamp) ? new Date(timestamp) : new Date(0)
  return date.toISOString().slice(0, 10)
}

interface MutableUsage {
  totals: TokenUsage
  models: Map<string, TokenUsage>
}

function mutableUsage(): MutableUsage {
  return { totals: emptyUsage(), models: new Map() }
}

/**
 * A provider's PLACEHOLDER for "no model was called" — not a model.
 *
 * Claude Code writes `"model":"<synthetic>"` on messages it fabricates locally (an interruption
 * notice, a cancellation), with every usage counter at zero. Verified in a real transcript:
 * `{"model":"<synthetic>","stop_reason":"stop_sequence","usage":{"input_tokens":0,…}}`. Measured
 * across this machine, it appeared in 30 sessions — third by session count in the model
 * distribution — while contributing nothing to any total.
 *
 * The angle brackets are the rule rather than a list of names: a model id does not contain them, so
 * a provider that marks something this way is telling us it is not an id. Recognising the SHAPE
 * means the next provider's marker is handled before we have seen it.
 */
function isPlaceholderModel(model: string): boolean {
  return model.startsWith('<') && model.endsWith('>')
}

function addTo(target: MutableUsage, usage: TokenUsage, model: string | undefined): void {
  // Totals first, unconditionally: a placeholder's counters are still this session's counters, and
  // dropping the sample rather than only its attribution would understate the session.
  target.totals = addUsage(target.totals, usage)
  if (!model || isPlaceholderModel(model)) return
  target.models.set(model, addUsage(target.models.get(model) ?? emptyUsage(), usage))
}

function countersOf(usage: TokenUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    requests: usage.requests,
  }
}

function restoreInto(
  target: MutableUsage,
  totals: TokenUsage,
  models: readonly ModelTokenUsage[],
): void {
  target.totals = countersOf(totals)
  for (const model of models) target.models.set(model.model, countersOf(model))
}

function modelsOf(source: MutableUsage): ModelTokenUsage[] {
  return [...source.models.entries()]
    .map(([model, usage]) => ({ model, ...usage }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
}

/**
 * Accumulates provider-reported request samples while retaining model and day attribution.
 *
 * Day attribution is request-time, not session-updated-time — the same separation CodexBar keeps
 * between its session breakdown and daily report.
 */
export class SessionUsageAccumulator {
  private readonly total = mutableUsage()
  private readonly days = new Map<string, MutableUsage>()

  /**
   * Continue from a previous `result()`. It is lossless — totals and models, per session and per
   * day, are exactly what this holds — which is what lets a resumed fold add only the new records.
   */
  static from(usage: SessionTokenUsage | undefined): SessionUsageAccumulator {
    const accumulator = new SessionUsageAccumulator()
    if (!usage) return accumulator
    restoreInto(accumulator.total, usage, usage.byModel)
    for (const day of usage.byDay) {
      const bucket = mutableUsage()
      restoreInto(bucket, day, day.byModel)
      accumulator.days.set(day.day, bucket)
    }
    return accumulator
  }

  add(usage: TokenUsage, model?: string, timestamp?: number): void {
    if (usage.totalTokens <= 0 && usage.requests <= 0) return
    this.apply(usage, model, timestamp)
  }

  /**
   * Replace a sample already added with a later reading of the same request, under the first
   * reading's model and day. A provider that rewrites a request as it streams reports the final
   * counts last; this adds the signed difference, so nothing is counted twice.
   */
  replace(previous: TokenUsage, next: TokenUsage, model?: string, timestamp?: number): void {
    this.apply(
      {
        inputTokens: next.inputTokens - previous.inputTokens,
        cachedInputTokens: next.cachedInputTokens - previous.cachedInputTokens,
        cacheWriteTokens: next.cacheWriteTokens - previous.cacheWriteTokens,
        outputTokens: next.outputTokens - previous.outputTokens,
        reasoningTokens: next.reasoningTokens - previous.reasoningTokens,
        totalTokens: next.totalTokens - previous.totalTokens,
        requests: next.requests - previous.requests,
      },
      model,
      timestamp,
    )
  }

  private apply(usage: TokenUsage, model?: string, timestamp?: number): void {
    addTo(this.total, usage, model)
    const day = dayOf(timestamp)
    const bucket = this.days.get(day) ?? mutableUsage()
    addTo(bucket, usage, model)
    this.days.set(day, bucket)
  }

  result(): SessionTokenUsage | undefined {
    if (this.total.totals.totalTokens <= 0 && this.total.totals.requests <= 0) return undefined
    const byDay: DailyTokenUsage[] = [...this.days.entries()]
      .map(([day, value]) => ({ day, ...value.totals, byModel: modelsOf(value) }))
      .sort((a, b) => a.day.localeCompare(b.day))
    return { ...this.total.totals, byModel: modelsOf(this.total), byDay }
  }
}

/** Bounded fan-out for cold-cache transcript parsing. Preserves input order. */
export async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: values.length })
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}
