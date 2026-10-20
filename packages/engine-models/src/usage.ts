/**
 * What a response cost: its token counts in the host's terms, priced from the catalog — or, where
 * the provider billed it and said so, at the billed amount.
 */
import type { SharedV4ProviderMetadata } from '@ai-sdk/provider'
import type { Usage } from '@localixai/agent'
import type { ModelCost } from '@localixai/agent/catalog'

import type { AssembledUsage } from './wire/finish'

const PER_MILLION = 1_000_000

/** The rates for a request of this size: the highest tier its input crossed, or the base rates. */
function ratesFor(cost: ModelCost, inputTokens: number) {
  const tier = [...(cost.tiers ?? [])]
    .sort((a, b) => b.inputTokensAbove - a.inputTokensAbove)
    .find((candidate) => inputTokens > candidate.inputTokensAbove)
  return tier ?? cost
}

/** OpenRouter reports what it billed; nothing else does, so nothing else is `actual`. */
function billedCost(metadata: SharedV4ProviderMetadata | undefined): number | undefined {
  const usage = metadata?.openrouter?.usage as { cost?: unknown } | undefined
  return typeof usage?.cost === 'number' ? usage.cost : undefined
}

export function priceUsage(
  counted: AssembledUsage | undefined,
  options: { cost?: ModelCost; subscription: boolean; metadata?: SharedV4ProviderMetadata },
): Usage | undefined {
  if (!counted) return undefined
  const cacheRead = counted.cacheReadTokens ?? 0
  const cacheWrite = counted.cacheWriteTokens ?? 0
  const freshInput = Math.max(0, counted.inputTokens - cacheRead - cacheWrite)
  const usage: Usage = {
    inputTokens: counted.inputTokens,
    outputTokens: counted.outputTokens,
    ...(counted.cacheReadTokens !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(counted.cacheWriteTokens !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(counted.reasoningTokens !== undefined ? { reasoningTokens: counted.reasoningTokens } : {}),
    totalTokens: counted.inputTokens + counted.outputTokens,
  }
  const billed = billedCost(options.metadata)
  if (!options.cost && billed === undefined) return usage
  const rates = options.cost ? ratesFor(options.cost, counted.inputTokens) : undefined
  const breakdown = {
    input: rates ? (freshInput * rates.input) / PER_MILLION : 0,
    output: rates ? (counted.outputTokens * rates.output) / PER_MILLION : 0,
    cacheRead: rates ? (cacheRead * (rates.cacheRead ?? rates.input)) / PER_MILLION : 0,
    cacheWrite: rates ? (cacheWrite * (rates.cacheWrite ?? rates.input)) / PER_MILLION : 0,
  }
  const estimated = breakdown.input + breakdown.output + breakdown.cacheRead + breakdown.cacheWrite
  const total = billed ?? estimated
  return {
    ...usage,
    totalCost: total,
    costSource:
      billed !== undefined ? 'actual' : options.subscription ? 'subscription' : 'estimated',
    cost: { ...breakdown, total },
  }
}
