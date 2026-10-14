import { describe, expect, test } from 'bun:test'

import { ActiveTurnTooLargeError, LocalContextBudgetExceededError } from '../context-budget'
import { classifyRunError } from './classify-run-error'

const frame = {
  rawWindow: 272_000,
  effectiveWindow: 256_000,
  reserve: 25_600,
  fixedOverhead: 10_000,
  trigger: 230_400,
  historyBudget: 220_400,
}

describe('local context policy classification', () => {
  test('recoverable old-history pressure compacts once without pretending it came from a provider', () => {
    const error = new LocalContextBudgetExceededError({
      reason: 'estimated_context_too_large',
      frame,
      requiredTokens: 231_000,
      availableTokens: 230_400,
      estimateSource: 'heuristic',
      message: 'Local policy estimate is over budget.',
    })

    expect(classifyRunError({}, 'u1', error)).toEqual({
      kind: 'context_overflow',
      userMessage: error.message,
      retryable: false,
      shouldCompress: true,
    })
  })

  test('an irreducible active turn is actionable and never enters compaction retry', () => {
    const error = new ActiveTurnTooLargeError({
      frame,
      requiredTokens: 230_000,
      availableTokens: 220_400,
      estimateSource: 'heuristic',
      message: 'Move the attachment to a file.',
    })

    expect(classifyRunError({}, 'u1', error)).toEqual({
      kind: 'fatal',
      userMessage: error.message,
      retryable: false,
    })
  })
})
