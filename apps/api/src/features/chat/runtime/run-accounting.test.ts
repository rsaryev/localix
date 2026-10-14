import { describe, expect, test } from 'bun:test'
import { classifyCostSource, calcUsageWithCost } from './run-accounting'

describe('classifyCostSource', () => {
  test('an estimated cost on an OAuth subscription key becomes "subscription"', () => {
    expect(classifyCostSource('oauth-pkce', 'estimated')).toBe('subscription')
    expect(classifyCostSource('oauth', 'estimated')).toBe('subscription') // legacy spelling
  })

  test('estimated on an api key stays estimated', () => {
    expect(classifyCostSource('api-key', 'estimated')).toBe('estimated')
    expect(classifyCostSource(null, 'estimated')).toBe('estimated')
  })
  test('an actual (metered) cost is never reclassified', () => {
    expect(classifyCostSource('oauth-pkce', 'actual')).toBe('actual')
  })
})

describe('calcUsageWithCost', () => {
  test('prices one-hour cache writes at 2x input instead of the five-minute rate', () => {
    const p = calcUsageWithCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWrite1hTokens: 400_000,
      },
      { input: 3, output: 15, cacheWrite: 3.75 },
    )
    // 600k short writes * $3.75/M + 400k one-hour writes * ($3*2)/M.
    expect(p.totalCost).toBeCloseTo(4.65, 6)
  })

  test('selects the highest matching long-context tier per request', () => {
    const cost = {
      input: 2,
      output: 10,
      tiers: [
        { inputTokensAbove: 200_000, input: 4, output: 15 },
        { inputTokensAbove: 500_000, input: 6, output: 20 },
      ],
    }
    expect(
      calcUsageWithCost({ inputTokens: 200_000, outputTokens: 1_000_000 }, cost).totalCost,
    ).toBeCloseTo(10.4, 6)
    expect(
      calcUsageWithCost({ inputTokens: 600_000, outputTokens: 1_000_000 }, cost).totalCost,
    ).toBeCloseTo(23.6, 6)
  })

  test('a provider-priced cost is authoritative → actual', () => {
    const p = calcUsageWithCost({
      inputTokens: 100,
      outputTokens: 50,
      totalCost: 0.5,
      costSource: 'actual',
    })
    expect(p.costSource).toBe('actual')
    expect(p.totalCost).toBe(0.5)
  })

  test('does not mistake an unlabelled runtime estimate for provider billing', () => {
    const p = calcUsageWithCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, totalCost: 99 },
      { input: 3, output: 15 },
    )
    expect(p.costSource).toBe('estimated')
    expect(p.totalCost).toBeCloseTo(10.5, 6)
  })

  test('estimates from model pricing (per-million), no cache', () => {
    const p = calcUsageWithCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { input: 3, output: 15 },
    )
    expect(p.costSource).toBe('estimated')
    expect(p.totalCost).toBeCloseTo(18, 6) // 3 (input) + 15 (output)
  })

  test('cache read/write use their own rates; non-cached input billed at full', () => {
    const p = calcUsageWithCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 100_000,
      },
      { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    )
    // nonCached=500k→1.5, output=15, cacheRead 400k*0.3/M=0.12, cacheWrite 100k*3.75/M=0.375
    expect(p.totalCost).toBeCloseTo(16.995, 6)
  })

  test('absent cache rates fall back to the full input rate', () => {
    const p = calcUsageWithCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 100_000,
      },
      { input: 3, output: 15 },
    )
    // all input-class tokens at rate 3 → 1M/M*3=3, output 15 → 18
    expect(p.totalCost).toBeCloseTo(18, 6)
  })

  test('no model pricing + no provider cost → cost stays undefined', () => {
    const p = calcUsageWithCost({ inputTokens: 100, outputTokens: 50 })
    expect(p.totalCost).toBeUndefined()
    expect(p.costSource).toBeUndefined()
  })

  test('a provider cost of 0 is NOT authoritative — falls back to the catalog estimate', () => {
    // OpenRouter sometimes returns cost: 0 when the figure is unavailable; a real
    // 1M-input / 0.5M-output turn must not be recorded as an authoritative $0.
    const p = calcUsageWithCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, totalCost: 0 },
      { input: 3, output: 15 },
    )
    expect(p.costSource).toBe('estimated')
    expect(p.totalCost).toBeCloseTo(3 + 7.5, 6) // 1M*3/M + 0.5M*15/M
  })

  test('a provider cost of 0 with no catalog pricing leaves it 0 with no source', () => {
    const p = calcUsageWithCost({ inputTokens: 100, outputTokens: 50, totalCost: 0 })
    expect(p.totalCost).toBe(0)
    expect(p.costSource).toBeUndefined()
  })
})
