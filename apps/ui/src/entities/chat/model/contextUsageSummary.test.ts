import { describe, expect, test } from 'bun:test'
import { buildUsageIndicatorView } from './contextUsageView'
import { describeContextUsage } from './contextUsageSummary'

describe('describeContextUsage', () => {
  test('says nothing was measured before the first reply', () => {
    expect(describeContextUsage(buildUsageIndicatorView({ contextWindow: 200_000 }))).toEqual({
      title: 'Context usage',
      detail: 'Nothing measured yet. Send a message first.',
    })
  })

  test('reads the share the builder computes, against the window it chose', () => {
    const view = buildUsageIndicatorView({
      usage: { contextTokens: 50_000 } as never,
      contextWindow: 200_000,
    })
    expect(view.percentLabel).toBe('25%')
    expect(describeContextUsage(view)).toEqual({
      title: 'Context 25% full',
      detail: '50.0k of 200.0k tokens.',
    })
  })

  test('keeps an overflow honest, and names an estimate and the next checkpoint', () => {
    const view = buildUsageIndicatorView({
      latestAttempt: {
        messageId: 'm',
        outcome: 'failed',
        stage: 'preflight',
        contextTokens: 120_000,
        tokenKind: 'estimated',
      },
      contextDiagnostics: { policyWindowTokens: 100_000, checkpointAtTokens: 80_000 } as never,
      contextWindow: 200_000,
    })
    const summary = describeContextUsage(view)
    expect(summary.title).toBe('Context 120% full')
    expect(summary.detail).toBe('120.0k of 100.0k tokens (estimated). Next checkpoint at 80.0k.')
  })
})
