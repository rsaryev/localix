import { describe, expect, test } from 'bun:test'
import type { ContextAttemptSnapshot } from './contextUsage'
import { buildUsageIndicatorView } from './contextUsageView'

const lastSuccess = {
  totalTokens: 143_663,
  inputTokens: 143_510,
  outputTokens: 153,
  contextTokens: 143_663,
}

describe('usage indicator view: context semantics', () => {
  test('does not use stale successful usage as the latest failed attempt', () => {
    const latestAttempt: ContextAttemptSnapshot = {
      messageId: 'failed',
      outcome: 'failed',
      stage: 'preflight',
      tokenKind: 'unknown',
    }

    const view = buildUsageIndicatorView({
      usage: lastSuccess,
      latestAttempt,
      contextWindow: 272_000,
    })

    expect(view.lastSuccessIsLatest).toBe(false)
    expect(view.attempt).toEqual({
      outcome: 'failed',
      stage: 'preflight',
      contextTokens: undefined,
      tokenKind: 'unknown',
    })
    expect(view.fraction).toBeNull()
    expect(view.percentLabel).toBe('—')
  })

  test('shows a preflight estimate against the Localix trigger, not the physical window', () => {
    const view = buildUsageIndicatorView({
      usage: lastSuccess,
      latestAttempt: {
        messageId: 'failed',
        outcome: 'failed',
        stage: 'preflight',
        tokenKind: 'unknown',
      },
      contextWindow: 272_000,
      contextDiagnostics: {
        sessionId: 's1',
        fullWindowTokens: 272_000,
        policyWindowTokens: 256_000,
        ceilingTokens: 230_400,
        checkpointAtTokens: 195_840,
        reservedTokens: 25_600,
        activeTokens: 232_388,
        activeTokensKind: 'estimated',
      },
    })

    expect(view.attempt).toMatchObject({
      outcome: 'failed',
      stage: 'preflight',
      contextTokens: 232_388,
      tokenKind: 'estimated',
    })
    expect(view.physicalWindowTokens).toBe(272_000)
    expect(view.policyWindowTokens).toBe(256_000)
    expect(view.ceilingTokens).toBe(230_400)
    expect(view.checkpointAtTokens).toBe(195_840)
    expect(view.fractionBasis).toBe('ceiling')
    expect(view.percentLabel).toBe('101%')
  })

  test('uses measured provider context and the physical window when no policy is reported', () => {
    const view = buildUsageIndicatorView({
      usage: lastSuccess,
      contextWindow: 272_000,
    })

    expect(view.attempt).toMatchObject({
      outcome: 'succeeded',
      stage: 'provider',
      contextTokens: 143_663,
      tokenKind: 'measured',
    })
    expect(view.fractionBasis).toBe('physical-window')
    expect(view.percentLabel).toBe('53%')
    expect(view.lastSuccessIsLatest).toBe(true)
  })

  test('a delegated child’s usage is measured against ITS ceiling, not the model’s window', () => {
    // Depth 1 budgets against 128k: the same 55 808 tokens are half of the child's ceiling and
    // a sliver of a 1M physical window — the percentage a person reads in the child's chat.
    const view = buildUsageIndicatorView({
      usage: { totalTokens: 55_808, inputTokens: 55_000, outputTokens: 808, contextTokens: 55_808 },
      contextWindow: 1_000_000,
      contextDiagnostics: {
        sessionId: 'child',
        fullWindowTokens: 1_000_000,
        policyWindowTokens: 128_000,
        ceilingTokens: 111_616,
        checkpointAtTokens: 94_873,
        reservedTokens: 16_384,
      },
    })
    expect(view.fractionBasis).toBe('ceiling')
    expect(view.percentLabel).toBe('50%')
    expect(view.checkpointAtTokens).toBe(94_873)
  })

  test('does not invent a default model window when diagnostics are unavailable', () => {
    const view = buildUsageIndicatorView({ usage: lastSuccess })

    expect(view.physicalWindowTokens).toBeUndefined()
    expect(view.fractionBasis).toBe('unknown')
    expect(view.percentLabel).toBe('—')
  })
})
