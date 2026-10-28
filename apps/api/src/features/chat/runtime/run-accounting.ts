import type { ChatUsagePayload } from '@localixai/agent'
import type { ModelCost, ModelCostRates } from '@localixai/agent/catalog'
import { usageToChatUsagePayload } from '@localixai/agent'

/**
 * Reclassify a cost source when the run used an OAuth subscription key.
 *
 * Anthropic (and similar providers) never return a monetary cost on their
 * Messages API, so `calcUsageWithCost` always tags those turns `'estimated'`.
 * When the connection is an OAuth subscription (Claude Pro/Max, etc.) the
 * catalog estimate is an API-equivalent value — NOT money the user is billed
 * per token.  Tag it `'subscription'` so the UI and aggregations can
 * distinguish it from real metered spend.
 *
 * Adapter-confirmed metered turns (`'actual'`) are never reclassified.
 */
export function classifyCostSource(
  /** authType from the ProviderConnectionKeyRecord that handled the request. */
  authType: string | null | undefined,
  /** The base costSource already computed by calcUsageWithCost. */
  base: ChatUsagePayload['costSource'],
): ChatUsagePayload['costSource'] {
  // Subscription keys are stored as 'oauth-pkce' (the KeyAuthType domain is
  // 'api-key' | 'oauth-pkce').
  if (base === 'estimated' && authType === 'oauth-pkce') return 'subscription'
  return base
}

// Calc usage cost from model pricing (prices are per million tokens).
// Token accounting convention (shared across all native providers after normalisation):
//   inputTokens     = total context tokens sent = nonCached + cacheRead + cacheWrite
//   cacheReadTokens = subset of inputTokens read from the prompt cache (billed cheaper)
//   cacheWriteTokens= subset of inputTokens written to the prompt cache (billed at premium)
//   totalTokens     = inputTokens + outputTokens
// Cost is: (inputTokens - cacheRead - cacheWrite) * input_rate
//         + cacheRead * cacheRead_rate
//         + cacheWrite * cacheWrite_rate
//         + outputTokens * output_rate
export function calcUsageWithCost(
  usage: Parameters<typeof usageToChatUsagePayload>[0],
  modelCost?: ModelCost,
) {
  const payload = usageToChatUsagePayload(usage)
  // Only the runtime adapter can declare a provider-reported cost authoritative.
  // The engine also supplies positive catalog estimates in `usage.cost`; inferring
  // `actual` from the number alone would misclassify those estimates.
  const providerPriced = payload.costSource === 'actual' && payload.totalCost !== undefined
  if (modelCost && !providerPriced) {
    payload.costSource = 'estimated'
    const rates = ratesForInput(modelCost, payload.inputTokens ?? 0)
    const cacheReadToks = payload.cachedInputTokens ?? 0
    const cacheWriteToks = payload.cacheWriteTokens ?? 0
    const cacheWrite1hToks = Math.min(cacheWriteToks, payload.cacheWrite1hTokens ?? 0)
    const cacheWrite5mToks = cacheWriteToks - cacheWrite1hToks
    // inputTokens = total context (nonCached + cacheRead + cacheWrite); subtract
    // both cache components to isolate the full-rate non-cached portion.
    const nonCachedInput = Math.max(0, (payload.inputTokens ?? 0) - cacheReadToks - cacheWriteToks)
    const inputCost = (nonCachedInput / 1_000_000) * rates.input
    const outputCost = ((payload.outputTokens ?? 0) / 1_000_000) * rates.output
    const cacheReadCost = (cacheReadToks / 1_000_000) * (rates.cacheRead ?? rates.input)
    // Anthropic's one-hour retention is 2x input, while ordinary cache creation uses
    // the catalog's cacheWrite rate (normally 1.25x). Other providers omit the split.
    const cacheWriteCost =
      (cacheWrite5mToks / 1_000_000) * (rates.cacheWrite ?? rates.input) +
      (cacheWrite1hToks / 1_000_000) * rates.input * 2
    payload.totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost
  }
  return payload
}

function ratesForInput(cost: ModelCost, inputTokens: number): ModelCostRates {
  let rates: ModelCostRates = cost
  let threshold = -1
  for (const tier of cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
      rates = tier
      threshold = tier.inputTokensAbove
    }
  }
  return rates
}
