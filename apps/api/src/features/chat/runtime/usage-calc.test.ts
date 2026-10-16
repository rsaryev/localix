import { describe, expect, it } from 'bun:test'
import { calcUsageWithCost } from './run-accounting'
import type { Usage } from '@localixai/agent'

/**
 * Usage calculation validation tests.
 *
 * Token accounting convention (shared across all native providers):
 *   inputTokens     = total context tokens = nonCached + cacheRead + cacheWrite
 *   cacheReadTokens = subset of input read from cache (cheaper)
 *   cacheWriteTokens= subset of input written to cache (premium)
 *   totalTokens     = inputTokens + outputTokens
 *
 * Cost = (inputTokens - cacheRead - cacheWrite) * inputRate
 *      + cacheRead * cacheReadRate
 *      + cacheWrite * cacheWriteRate
 *      + outputTokens * outputRate
 */

const MODEL_COST = {
  input: 3.0, // $3 / 1M tokens
  output: 15.0, // $15 / 1M tokens
  cacheRead: 0.3, // $0.30 / 1M (10% of input)
  cacheWrite: 3.75, // $3.75 / 1M (125% of input)
}

describe('calcUsageWithCost', () => {
  it('prices pure non-cached input + output correctly', () => {
    const result = calcUsageWithCost(
      { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      MODEL_COST,
    )
    expect(result.costSource).toBe('estimated')
    // cost = 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
    expect(result.totalCost).toBeCloseTo(0.0105, 6)
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
    expect(result.totalTokens).toBe(1500)
  })

  it('correctly prices Anthropic-style usage where inputTokens includes cache tokens', () => {
    // Typical Anthropic session:
    //   Anthropic reports: input_tokens=100, cache_read=50000, cache_write=200
    //   After normalisation in applyUsage:
    //     inputTokens = 100 + 50000 + 200 = 50300 (total context)
    //     cacheReadTokens = 50000
    //     cacheWriteTokens = 200
    const result = calcUsageWithCost(
      {
        inputTokens: 50300,
        outputTokens: 800,
        cacheReadTokens: 50000,
        cacheWriteTokens: 200,
        totalTokens: 51100,
      },
      MODEL_COST,
    )
    // nonCachedInput = 50300 - 50000 - 200 = 100
    // inputCost      = 100   * 3/1M     = 0.000300
    // cacheReadCost  = 50000 * 0.3/1M   = 0.015000
    // cacheWriteCost = 200   * 3.75/1M  = 0.000750
    // outputCost     = 800   * 15/1M    = 0.012000
    // total          = 0.028050
    expect(result.totalCost).toBeCloseTo(0.02805, 5)
    expect(result.costSource).toBe('estimated')
  })

  it('does NOT over-charge when only cacheRead is present (no cacheWrite)', () => {
    const result = calcUsageWithCost(
      { inputTokens: 10100, outputTokens: 300, cacheReadTokens: 10000, totalTokens: 10400 },
      MODEL_COST,
    )
    // nonCachedInput = 10100 - 10000 - 0 = 100
    // inputCost      = 100   * 3/1M    = 0.000300
    // cacheReadCost  = 10000 * 0.3/1M  = 0.003000
    // outputCost     = 300   * 15/1M   = 0.004500
    // total          = 0.007800
    expect(result.totalCost).toBeCloseTo(0.0078, 6)
  })

  it('does NOT double-count: cacheWrite is NOT charged at both inputRate AND cacheWriteRate', () => {
    // If nonCachedInput were NOT subtracting cacheWrite, cacheWrite would be charged twice.
    const result = calcUsageWithCost(
      { inputTokens: 2000, outputTokens: 100, cacheWriteTokens: 1000, totalTokens: 2100 },
      MODEL_COST,
    )
    // nonCachedInput = 2000 - 0 - 1000 = 1000 (cacheWrite subtracted, not double-charged)
    // inputCost      = 1000 * 3/1M     = 0.003000
    // cacheWriteCost = 1000 * 3.75/1M  = 0.003750
    // outputCost     = 100  * 15/1M    = 0.001500
    // total          = 0.008250
    expect(result.totalCost).toBeCloseTo(0.00825, 6)

    // Verify it's NOT the double-count value (would be 0.003 + 0.00375 + 0.003 + 0.0015 = 0.01125)
    expect(result.totalCost).not.toBeCloseTo(0.01125, 6)
  })

  it('passes through a cost only when the runtime adapter marks it actual', () => {
    const result = calcUsageWithCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        totalCost: 0.0099,
        costSource: 'actual',
      },
      MODEL_COST,
    )
    expect(result.totalCost).toBe(0.0099)
    expect(result.costSource).toBe('actual')
  })

  it('recalculates an unclassified runtime estimate instead of calling it actual', () => {
    const result = calcUsageWithCost(
      { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, totalCost: 0.0099 },
      MODEL_COST,
    )
    expect(result.totalCost).toBeCloseTo(0.0105, 6)
    expect(result.costSource).toBe('estimated')
  })

  it('returns undefined cost when no model cost is provided', () => {
    const result = calcUsageWithCost({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 })
    expect(result.totalCost).toBeUndefined()
    expect(result.costSource).toBeUndefined()
  })

  it('accumulates correctly across multiple turns (integer summation avoids float drift)', () => {
    // Simulate a 3-turn agent run; cost should be the sum of all turns' costs.
    // Typed as real `Usage` records: a turn that reports no cache read/write OMITS the field
    // (that is exactly what the `?? 0` folds below handle), and only the declared type makes
    // reading an absent-but-optional field legal instead of a typo waiting to happen.
    const turn1: Usage = {
      inputTokens: 1000,
      outputTokens: 300,
      cacheWriteTokens: 500,
      totalTokens: 1300,
    }
    const turn2: Usage = {
      inputTokens: 1500,
      outputTokens: 400,
      cacheReadTokens: 500,
      totalTokens: 1900,
    }
    const turn3: Usage = {
      inputTokens: 2000,
      outputTokens: 200,
      cacheReadTokens: 1000,
      totalTokens: 2200,
    }

    const totals = {
      inputTokens: turn1.inputTokens + turn2.inputTokens + turn3.inputTokens,
      outputTokens: turn1.outputTokens + turn2.outputTokens + turn3.outputTokens,
      cacheReadTokens:
        (turn1.cacheReadTokens ?? 0) + (turn2.cacheReadTokens ?? 0) + (turn3.cacheReadTokens ?? 0),
      cacheWriteTokens:
        (turn1.cacheWriteTokens ?? 0) +
        (turn2.cacheWriteTokens ?? 0) +
        (turn3.cacheWriteTokens ?? 0),
      totalTokens: (turn1.totalTokens ?? 0) + (turn2.totalTokens ?? 0) + (turn3.totalTokens ?? 0),
    }
    // sum: input=4500, output=900, cacheRead=1500, cacheWrite=500, total=5400
    expect(totals.inputTokens).toBe(4500)
    expect(totals.outputTokens).toBe(900)

    const result = calcUsageWithCost(totals, MODEL_COST)
    // nonCachedInput = 4500 - 1500 - 500 = 2500
    // inputCost      = 2500 * 3/1M    = 0.007500
    // cacheReadCost  = 1500 * 0.3/1M  = 0.000450
    // cacheWriteCost = 500  * 3.75/1M = 0.001875
    // outputCost     = 900  * 15/1M   = 0.013500
    // total          = 0.023325
    expect(result.totalCost).toBeCloseTo(0.023325, 5)
  })

  it('clamps nonCachedInput to 0 when cache tokens exceed inputTokens (defensive guard)', () => {
    // Edge case: provider reports more cache tokens than inputTokens (shouldn't happen, but guard it)
    const result = calcUsageWithCost(
      { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, totalTokens: 150 },
      MODEL_COST,
    )
    // nonCachedInput = max(0, 100 - 200 - 0) = 0
    // cacheReadCost  = 200 * 0.3/1M = 0.000060  (uses modelCost.cacheRead which is given)
    // outputCost     = 50  * 15/1M  = 0.000750
    // total          = 0.000810
    //
    // The comment above always computed the right answer; the assertion then declined to check
    // it. `>= 0` cannot see the clamp: WITHOUT it nonCachedInput is −100, inputCost is −0.0003,
    // and the total is still a cheerful +0.00051 — non-negative, and wrong. Assert the number.
    expect(result.totalCost).toBeCloseTo(0.00081, 6)
    expect(result.inputTokens).toBe(100)
  })
})
