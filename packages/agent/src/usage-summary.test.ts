import { describe, expect, test } from 'bun:test'
import {
  cacheHitRate,
  combineUsage,
  createUsageAccumulator,
  accumulateUsage,
  finishUsageAccumulator,
  hasRecordedUsage,
  uncachedInputTokens,
  replaceUsageInSummary,
} from './usage-summary'

describe('canonical usage summary', () => {
  test('sums each available field and keeps subscription provenance', () => {
    const summary = combineUsage([
      {
        totalTokens: 10,
        inputTokens: 8,
        outputTokens: 2,
        cachedInputTokens: 5,
        totalCost: 0.1,
        costSource: 'subscription',
      },
      {
        totalTokens: 20,
        inputTokens: 12,
        outputTokens: 8,
        totalCost: 0.2,
        costSource: 'subscription',
      },
    ])
    expect(summary).toMatchObject({
      totalTokens: 30,
      inputTokens: 20,
      outputTokens: 10,
      cachedInputTokens: 5,
      costSource: 'subscription',
      isSummary: true,
    })
    expect(summary?.totalCost).toBeCloseTo(0.3, 10)
  })

  test('labels mixed cost provenance conservatively as estimated', () => {
    expect(
      combineUsage([
        { totalTokens: 1, totalCost: 0.1, costSource: 'actual' },
        { totalTokens: 1, totalCost: 0.2, costSource: 'subscription' },
      ])?.costSource,
    ).toBe('estimated')
  })

  test('supports a single-pass accumulator and partial provider payloads', () => {
    const accumulator = createUsageAccumulator()
    accumulateUsage(accumulator, { inputTokens: 3 })
    accumulateUsage(accumulator, { outputTokens: 2 })
    expect(finishUsageAccumulator(accumulator)).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
    })
    expect(hasRecordedUsage({ totalTokens: 0, totalCost: 0 })).toBe(false)
  })

  test('ignores corrupt negative and non-finite legacy fields consistently', () => {
    expect(
      combineUsage([
        {
          inputTokens: 10,
          outputTokens: -5,
          cachedInputTokens: Number.NaN,
          cacheWriteTokens: Number.POSITIVE_INFINITY,
          totalTokens: -20,
          totalCost: -1,
        },
      ]),
    ).toMatchObject({ inputTokens: 10, totalTokens: 10, isSummary: true })
    expect(hasRecordedUsage({ totalTokens: Number.POSITIVE_INFINITY })).toBe(false)
  })

  test('owns cache math shared by API and both clients', () => {
    expect(cacheHitRate(81, 100)).toBe(81)
    expect(uncachedInputTokens(100, 81, 9)).toBe(10)
  })
})

describe('replaceUsageInSummary', () => {
  test('replaces a live turn without losing unloaded-history totals', () => {
    expect(
      replaceUsageInSummary(
        {
          inputTokens: 110,
          outputTokens: 12,
          totalTokens: 122,
          totalCost: 1.1,
        },
        { inputTokens: 10, outputTokens: 2, totalTokens: 12, totalCost: 0.1 },
        { inputTokens: 20, outputTokens: 4, totalTokens: 24, totalCost: 0.2 },
      ),
    ).toMatchObject({
      inputTokens: 120,
      outputTokens: 14,
      totalTokens: 134,
      totalCost: 1.2,
    })
  })

  test('does not let malformed live fields poison an authoritative summary', () => {
    expect(
      replaceUsageInSummary(
        { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        {
          inputTokens: Number.NaN,
          outputTokens: -1,
          totalTokens: Number.POSITIVE_INFINITY,
        },
      ),
    ).toMatchObject({ inputTokens: 90, outputTokens: 18, totalTokens: 108 })
  })
})
