import { describe, expect, test } from 'bun:test'

import {
  ActiveTurnTooLargeError,
  FixedOverheadTooLargeError,
  LOCAL_CONTEXT_BUDGET_ERROR_CODE,
  LocalContextBudgetExceededError,
  historyBudgetTokens,
  assertFixedOverheadFits,
  resolveContextBudgetFrame,
  scaledReserveTokens,
} from './context-budget'
import { CONTEXT_LIMIT_AUTO_TOKENS, CONTEXT_LIMIT_STEPS } from '@localixai/agent'

describe('resolveContextBudgetFrame', () => {
  test('derives every limit from one effective window', () => {
    const frame = resolveContextBudgetFrame({
      contextWindow: 372_000,
      fixedOverheadTokens: 10_000,
    })

    expect(frame).toEqual({
      rawWindow: 372_000,
      effectiveWindow: 302_222,
      reserve: 30_222,
      fixedOverhead: 10_000,
      trigger: 272_000,
      historyBudget: 262_000,
    })
    expect(historyBudgetTokens(frame.effectiveWindow, frame.fixedOverhead)).toBe(
      frame.historyBudget,
    )
  })

  test('Auto is a 272k ceiling on a large window; Full keeps the physical one', () => {
    expect(resolveContextBudgetFrame({ contextWindow: 1_000_000 })).toMatchObject({
      effectiveWindow: 302_222,
      reserve: 30_222,
      trigger: 272_000,
    })
    expect(
      resolveContextBudgetFrame({ contextWindow: 1_000_000, contextLimit: 'full' }).trigger,
    ).toBe(900_000)
    expect(
      resolveContextBudgetFrame({
        contextWindow: 32_000,
        fixedOverheadTokens: 7_100,
        contextLimit: 'full',
      }),
    ).toEqual({
      rawWindow: 32_000,
      effectiveWindow: 32_000,
      reserve: 6_400,
      fixedOverhead: 7_100,
      trigger: 25_600,
      historyBudget: 18_500,
    })
  })

  test('every step a model can hold becomes exactly that request ceiling', () => {
    for (const step of CONTEXT_LIMIT_STEPS) {
      const { trigger } = resolveContextBudgetFrame({
        contextWindow: 20_000_000,
        contextLimit: step,
      })
      expect(trigger).toBeGreaterThanOrEqual(step)
      expect(trigger).toBe(step)
    }
  })

  test('Auto never drops below min(272k, window - reserve)', () => {
    const windows = [8_000, 32_000, 128_000, 200_000, 262_144, 272_000, 300_000, 302_222, 302_222]
    for (const window of [...windows, 400_000, 1_000_000, 2_000_000, 10_000_000]) {
      const { trigger } = resolveContextBudgetFrame({ contextWindow: window })
      expect(trigger).toBeGreaterThanOrEqual(
        Math.min(CONTEXT_LIMIT_AUTO_TOKENS, window - scaledReserveTokens(window)),
      )
    }
    // A window under 272k + reserve gets exactly its own window minus the reserve.
    expect(resolveContextBudgetFrame({ contextWindow: 272_000 }).trigger).toBe(244_800)
  })

  test('stored values outside the ladder are read safely, never as errors', () => {
    // Below the ladder → its first step; above → Full; garbage → Auto.
    expect(resolveContextBudgetFrame({ contextWindow: 1_000_000, contextLimit: 5 }).trigger).toBe(
      128_000,
    )
    expect(
      resolveContextBudgetFrame({ contextWindow: 1_000_000, contextLimit: 99_000_000 }).trigger,
    ).toBe(900_000)
    expect(
      resolveContextBudgetFrame({ contextWindow: 1_000_000, contextLimit: Number.NaN }).trigger,
    ).toBe(272_000)
  })

  test('missing catalog metadata uses the conservative fallback', () => {
    const frame = resolveContextBudgetFrame()
    expect(frame.rawWindow).toBe(128_000)
    expect(frame.effectiveWindow).toBe(128_000)
    expect(frame.trigger).toBe(111_616)
    expect(frame.historyBudget).toBe(frame.trigger)
  })

  test('invalid overhead never creates negative or fractional budgets', () => {
    expect(
      resolveContextBudgetFrame({ contextWindow: 32_000, fixedOverheadTokens: -1 }),
    ).toMatchObject({ fixedOverhead: 0, historyBudget: 25_600 })
    expect(
      resolveContextBudgetFrame({ contextWindow: 32_000, fixedOverheadTokens: 99_999.9 }),
    ).toMatchObject({ fixedOverhead: 99_999, historyBudget: 0 })
  })
})

describe('LocalContextBudgetExceededError', () => {
  test('carries stable typed diagnostics instead of mimicking provider overflow text', () => {
    const frame = resolveContextBudgetFrame({ contextWindow: 32_000 })
    const error = new ActiveTurnTooLargeError({
      frame,
      requiredTokens: 30_000,
      availableTokens: frame.historyBudget,
      estimateSource: 'heuristic',
      protectedMessageIds: ['active'],
      message: 'The active turn is too large.',
    })

    expect(error).toBeInstanceOf(LocalContextBudgetExceededError)
    expect(error).toMatchObject({
      code: LOCAL_CONTEXT_BUDGET_ERROR_CODE,
      reason: 'active_turn_too_large',
      requiredTokens: 30_000,
      availableTokens: 25_600,
      protectedMessageIds: ['active'],
    })
    expect(error.message).not.toContain('Context window exceeded')
  })

  test('classifies an impossible fixed prompt floor separately from message failures', () => {
    const frame = resolveContextBudgetFrame({
      contextWindow: 16_384,
      fixedOverheadTokens: 20_000,
    })

    let failure: unknown
    try {
      assertFixedOverheadFits(frame)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FixedOverheadTooLargeError)
    expect(failure).toMatchObject({
      code: LOCAL_CONTEXT_BUDGET_ERROR_CODE,
      reason: 'fixed_overhead_too_large',
      requiredTokens: 20_000,
      availableTokens: frame.trigger,
    })
  })

  test('reports the prompt floor when it exactly consumes the request budget', () => {
    // An overhead EQUAL to the trigger leaves historyBudget at zero, so no active turn
    // could ever fit. Passing this frame through would blame the user's message and
    // recommend compaction, which cannot reclaim a single system-prompt token.
    const sized = resolveContextBudgetFrame({ contextWindow: 16_384 })
    const frame = resolveContextBudgetFrame({
      contextWindow: 16_384,
      fixedOverheadTokens: sized.trigger,
    })
    expect(frame.historyBudget).toBe(0)

    let failure: unknown
    try {
      assertFixedOverheadFits(frame)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FixedOverheadTooLargeError)
    expect(failure).toMatchObject({ reason: 'fixed_overhead_too_large' })
    expect((failure as Error).message).toContain('no room for conversation history')
  })

  test('still admits a frame that leaves even one token of history', () => {
    const sized = resolveContextBudgetFrame({ contextWindow: 16_384 })
    const frame = resolveContextBudgetFrame({
      contextWindow: 16_384,
      fixedOverheadTokens: sized.trigger - 1,
    })
    expect(frame.historyBudget).toBe(1)
    expect(() => assertFixedOverheadFits(frame)).not.toThrow()
  })
})
