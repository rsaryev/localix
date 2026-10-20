/**
 * WHAT ONE MODEL OFFERS, read from its models.dev record: the reasoning levels a caller may ask
 * for, its prices in the host's terms, and how much context the host may fill.
 */
import type { ModelCost } from '@localixai/agent/catalog'
import type { Model, ModelCost as PriceRecord, ReasoningOption } from '@opencode-ai/models'

import type { Route } from './families'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const COMMON_LEVELS = ['low', 'medium', 'high']

/**
 * The levels a caller may ask a model for, as models.dev's authoring rules define them:
 * - `effort` names the levels; `none` (or `null`) among them is `off`, `default` is no level;
 * - `toggle` switches reasoning off and on;
 * - `budget_tokens` takes the common three, and `off` unless its budget has a floor above zero;
 * - no option at all is reasoning the caller does not control: nothing is offered or sent.
 * The Anthropic wire always takes `off`: its SDK disables thinking, or keeps it as low as a model
 * that cannot think less allows.
 */
export function reasoningLevels(
  model: Pick<Model, 'reasoning' | 'reasoning_options'>,
  route?: Route,
): string[] {
  if (!model.reasoning) return []
  const options: readonly ReasoningOption[] = model.reasoning_options ?? []
  if (options.length === 0) return []
  const offered = new Set<string>()
  for (const option of options) {
    if (option.type === 'toggle') offered.add('off')
    else if (option.type === 'budget_tokens') {
      for (const level of COMMON_LEVELS) offered.add(level)
      if (!option.min || option.min <= 0) offered.add('off')
    } else {
      for (const value of option.values) {
        if (value === null || value === 'none') offered.add('off')
        else if (LEVELS.includes(value)) offered.add(value)
      }
    }
  }
  // A switch with nothing graded beside it: on is the provider's own level.
  if (![...offered].some((level) => level !== 'off')) offered.add('medium')
  if (route?.family === 'anthropic') offered.add('off')
  return LEVELS.filter((level) => offered.has(level))
}

export function costOf(price: PriceRecord | undefined): ModelCost | undefined {
  if (price?.input === undefined || price.output === undefined) return undefined
  const tiers = (price.tiers ?? []).flatMap((tier) =>
    tier.tier?.type === 'context' && typeof tier.tier.size === 'number'
      ? [
          {
            inputTokensAbove: tier.tier.size,
            input: tier.input,
            output: tier.output,
            ...(tier.cache_read !== undefined ? { cacheRead: tier.cache_read } : {}),
            ...(tier.cache_write !== undefined ? { cacheWrite: tier.cache_write } : {}),
          },
        ]
      : [],
  )
  return {
    input: price.input,
    output: price.output,
    ...(price.cache_read !== undefined ? { cacheRead: price.cache_read } : {}),
    ...(price.cache_write !== undefined ? { cacheWrite: price.cache_write } : {}),
    ...(tiers.length > 0 ? { tiers } : {}),
  }
}

/**
 * How much context the host may fill: the model's input limit, but no further than its first
 * long-context price tier. Past it every request is billed at the higher rate, so a history
 * allowed to grow there would raise the cost of each turn without anyone choosing it.
 */
export function contextWindowOf(
  limit: Model['limit'] | undefined,
  cost: ModelCost | undefined,
): number | undefined {
  const window = limit?.input ?? limit?.context
  const firstTier = cost?.tiers?.reduce(
    (low, tier) => Math.min(low, tier.inputTokensAbove),
    Infinity,
  )
  const cap = firstTier !== undefined && Number.isFinite(firstTier) ? firstTier : undefined
  if (window === undefined || window <= 0) return cap
  return cap !== undefined ? Math.min(window, cap) : window
}
