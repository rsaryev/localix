import { describe, expect, test } from 'bun:test'

import {
  CONTEXT_LIMIT_STEPS,
  ceilingOfWindow,
  contextLimitChoices,
  contextLimitWindow,
  formatContextTokens,
  normalizeContextLimit,
  windowForCeiling,
} from './context-limit'

describe('windowForCeiling', () => {
  test('is the smallest window whose ceiling holds the request, in every reserve regime', () => {
    for (const ceiling of [1_000, 50_000, 65_536, 65_537, 100_000, 147_456, 147_457, 272_000]) {
      const window = windowForCeiling(ceiling)
      expect(ceilingOfWindow(window)).toBeGreaterThanOrEqual(ceiling)
      expect(ceilingOfWindow(window - 1)).toBeLessThan(ceiling)
    }
  })
})

describe('contextLimitChoices', () => {
  const offered = (window: number) => {
    const c = contextLimitChoices(window)
    return { auto: c.auto, full: c.full, steps: c.steps, adjustable: c.adjustable }
  }

  test('a model that cannot hold more than Auto has nothing to choose', () => {
    expect(offered(128_000)).toEqual({ auto: 111_616, full: 111_616, steps: [], adjustable: false })
    expect(offered(272_000).adjustable).toBe(false)
    expect(offered(302_222).adjustable).toBe(false)
    expect(offered(302_223).adjustable).toBe(true)
  })

  test('each larger window offers the ladder steps it holds, like reasoning levels', () => {
    expect(offered(400_000)).toEqual({
      auto: 272_000,
      full: 360_000,
      steps: [128_000, 200_000],
      adjustable: true,
    })
    expect(offered(1_000_000).steps).toEqual([128_000, 200_000, 400_000, 600_000])
    expect(offered(2_000_000).steps).toEqual([128_000, 200_000, 400_000, 600_000, 1_000_000])
    // A future window needs no code change: the ladder already reaches it.
    expect(offered(10_000_000).steps.slice(-1)).toEqual([5_000_000])
    expect(offered(20_000_000).steps).toEqual([...CONTEXT_LIMIT_STEPS])
  })

  test('the ceiling in force is what the runtime budgets with', () => {
    expect(contextLimitChoices(1_000_000).currentTokens).toBe(272_000)
    expect(contextLimitChoices(1_000_000, 600_000).currentTokens).toBe(600_000)
    expect(contextLimitChoices(1_000_000, 'full').currentTokens).toBe(900_000)
    // Remembered from a bigger model: the step reads as this model's whole window.
    expect(contextLimitChoices(400_000, 2_000_000).currentTokens).toBe(360_000)
  })
})

describe('stored values', () => {
  test('normalise without throwing: garbage is Auto, the extremes clamp', () => {
    expect(normalizeContextLimit(undefined)).toBeUndefined()
    expect(normalizeContextLimit('70%')).toBeUndefined()
    expect(normalizeContextLimit(Number.NaN)).toBeUndefined()
    expect(normalizeContextLimit(10)).toBe(128_000)
    expect(normalizeContextLimit(99_000_000)).toBe('full')
    expect(normalizeContextLimit('full')).toBe('full')
  })

  test('a limit never budgets past the model window', () => {
    expect(contextLimitWindow(200_000, 600_000)).toBe(200_000)
    expect(contextLimitWindow(200_000)).toBe(200_000)
    expect(contextLimitWindow(1_000_000, 'full')).toBe(1_000_000)
  })
})

test('token counts read compactly', () => {
  expect(formatContextTokens(128_000)).toBe('128k')
  expect(formatContextTokens(272_000)).toBe('272k')
  expect(formatContextTokens(900_000)).toBe('900k')
  expect(formatContextTokens(1_000_000)).toBe('1M')
  expect(formatContextTokens(2_500_000)).toBe('2.5M')
})
