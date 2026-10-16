import { describe, expect, test } from 'bun:test'
import { calcUsageWithCost, classifyCostSource } from './run-accounting'

// Anthropic-like pricing (per million tokens) for the assertions below.
const cost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

describe('calcUsageWithCost', () => {
  test('prices cache-write tokens (the previously-dropped term)', () => {
    // inputTokens is the TOTAL context (nonCached + cacheRead + cacheWrite), so
    // 2M total with 1M cache-write means 1M is full-rate non-cached input.
    const u = calcUsageWithCost(
      { inputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
      cost,
    )
    // 1M non-cached input * $3 + 1M cache-write * $3.75 = $6.75
    expect(u.totalCost).toBeCloseTo(6.75, 6)
    expect(u.cacheWriteTokens).toBe(1_000_000)
  })

  test('splits cached vs non-cached input correctly', () => {
    const u = calcUsageWithCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 800_000,
        cacheWriteTokens: 0,
      },
      cost,
    )
    // non-cached = 200k*$3 = 0.6 ; cacheRead = 800k*$0.3 = 0.24 ; output = 500k*$15 = 7.5
    expect(u.totalCost).toBeCloseTo(0.6 + 0.24 + 7.5, 6)
  })

  test('falls back to input price when cacheWrite price is absent', () => {
    const u = calcUsageWithCost(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 },
      { input: 3, output: 15 },
    )
    expect(u.totalCost).toBeCloseTo(3, 6)
  })

  test('omitting cache-write would undercount — regression guard', () => {
    const withWrite = calcUsageWithCost(
      {
        inputTokens: 200_000,
        outputTokens: 6_000,
        cacheReadTokens: 520_000,
        cacheWriteTokens: 520_000,
      },
      cost,
    )
    const withoutWrite = calcUsageWithCost(
      { inputTokens: 200_000, outputTokens: 6_000, cacheReadTokens: 520_000, cacheWriteTokens: 0 },
      cost,
    )
    // cache-write is a large, premium-priced term — its omission was the 5x bug.
    expect(withWrite.totalCost!).toBeGreaterThan(withoutWrite.totalCost!)
  })

  test('tags costSource: estimated when computed from catalog, actual when pre-priced', () => {
    const estimated = calcUsageWithCost(
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost,
    )
    expect(estimated.costSource).toBe('estimated')

    // Provider already reported a real cost → trust it, don't recompute.
    const actual = calcUsageWithCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0.42,
        costSource: 'actual',
      },
      cost,
    )
    expect(actual.costSource).toBe('actual')
    expect(actual.totalCost).toBe(0.42)
  })

  test('accumulating turns then pricing once == sum of per-turn prices (no last-turn undercount)', () => {
    // Two turns of a single run, as the agent-runner accumulator folds them.
    const turn1 = {
      inputTokens: 100_000,
      outputTokens: 2_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 0,
    }
    const turn2 = {
      inputTokens: 120_000,
      outputTokens: 3_000,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 10_000,
    }
    const totals = {
      inputTokens: turn1.inputTokens + turn2.inputTokens,
      outputTokens: turn1.outputTokens + turn2.outputTokens,
      cacheReadTokens: turn1.cacheReadTokens + turn2.cacheReadTokens,
      cacheWriteTokens: turn1.cacheWriteTokens + turn2.cacheWriteTokens,
    }

    const summedOnce = calcUsageWithCost(totals, cost).totalCost!
    const perTurnSum =
      calcUsageWithCost(turn1, cost).totalCost! + calcUsageWithCost(turn2, cost).totalCost!
    // Pricing the summed integer tokens equals summing per-turn prices.
    expect(summedOnce).toBeCloseTo(perTurnSum, 6)
    // And it is strictly more than reporting only the last turn — the bug this fixes.
    expect(summedOnce).toBeGreaterThan(calcUsageWithCost(turn2, cost).totalCost!)
  })
})

describe('classifyCostSource', () => {
  test('oauth-pkce subscription key + estimated → subscription', () => {
    // 'oauth-pkce' is the real KeyAuthType value stored for subscription keys.
    expect(classifyCostSource('oauth-pkce', 'estimated')).toBe('subscription')
  })

  test('legacy oauth spelling + estimated → subscription', () => {
    expect(classifyCostSource('oauth', 'estimated')).toBe('subscription')
  })

  test('api-key + estimated → stays estimated', () => {
    expect(classifyCostSource('api-key', 'estimated')).toBe('estimated')
  })

  test('oauth-pkce key + actual → stays actual (OpenRouter reported real cost)', () => {
    expect(classifyCostSource('oauth-pkce', 'actual')).toBe('actual')
  })

  test('null authType + estimated → stays estimated', () => {
    expect(classifyCostSource(null, 'estimated')).toBe('estimated')
  })

  test('undefined authType + estimated → stays estimated', () => {
    expect(classifyCostSource(undefined, 'estimated')).toBe('estimated')
  })

  test('oauth key + undefined source → stays undefined', () => {
    expect(classifyCostSource('oauth', undefined)).toBeUndefined()
  })

  test('subscription source passes through unchanged', () => {
    // Idempotent: re-classifying an already-subscription source is a no-op.
    expect(classifyCostSource('oauth', 'subscription')).toBe('subscription')
  })
})
