import { DEFAULT_AGENT_PARTICIPANT } from '../../../db'
import { describe, expect, test } from 'bun:test'

import { emptyAssistantPayload } from './message-envelope'
import {
  contextWindowDiagnostics,
  withContextWindowLimits,
  withTerminalContextDiagnostics,
} from './context-diagnostics'
import { resolveContextBudgetFrame } from './context-budget'

const frame = {
  rawWindow: 272_000,
  effectiveWindow: 256_000,
  reserve: 25_600,
  fixedOverhead: 10_000,
  trigger: 230_400,
  historyBudget: 220_400,
}

describe('terminal context diagnostics', () => {
  test('keeps physical capacity, host policy and measurement provenance separate', () => {
    expect(contextWindowDiagnostics('s1', frame, { tokens: 143_663, kind: 'measured' })).toEqual({
      sessionId: 's1',
      fullWindowTokens: 272_000,
      policyWindowTokens: 256_000,
      ceilingTokens: 230_400,
      // The next checkpoint fires at the high-water mark of that ceiling (0.85 × 230 400).
      checkpointAtTokens: 195_840,
      reservedTokens: 25_600,
      activeTokens: 143_663,
      activeTokensKind: 'measured',
    })
  })

  test('replaces stale context parts without touching unrelated data', () => {
    const payload = {
      ...emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      dataParts: [
        {
          type: 'data-status' as const,
          data: { scope: 'provider', phase: 'completed', message: 'ok' },
        },
        { type: 'data-context-attempt' as const, data: { outcome: 'running' } },
      ],
    }
    const next = withTerminalContextDiagnostics(payload, {
      window: contextWindowDiagnostics('s1', frame),
      attempt: {
        outcome: 'failed',
        stage: 'preflight',
        contextTokens: 232_388,
        tokenKind: 'estimated',
      },
    })

    expect(next.dataParts?.map((part) => part.type)).toEqual([
      'data-status',
      'data-context-window',
      'data-context-attempt',
    ])
    expect(next.dataParts?.at(-1)?.data).toEqual({
      outcome: 'failed',
      stage: 'preflight',
      contextTokens: 232_388,
      tokenKind: 'estimated',
    })
  })
})

describe('window limits at the start of a run', () => {
  test('ride the first snapshot, beside whatever else the payload carries', () => {
    // Only the terminal write carried them, so a session's whole first run had a ring with no
    // denominator but the model's physical window.
    const payload = {
      ...emptyAssistantPayload('a1', DEFAULT_AGENT_PARTICIPANT),
      dataParts: [
        { type: 'data-status' as const, data: { scope: 'provider', phase: 'running' } },
        { type: 'data-context-window' as const, data: { stale: true } },
      ],
    }
    const next = withContextWindowLimits(payload, contextWindowDiagnostics('s1', frame))
    expect(next.dataParts?.map((part) => part.type)).toEqual(['data-status', 'data-context-window'])
    expect(next.dataParts?.at(-1)?.data).toMatchObject({ ceilingTokens: 230_400 })
  })

  test('a delegated child budgets against ITS window, not the conversation’s', () => {
    // Depth 1: 128k policy window, a 16 384 reserve → a 111 616 ceiling, the checkpoint at 85%.
    const child = resolveContextBudgetFrame({ contextWindow: 1_000_000, depth: 1 })
    expect(contextWindowDiagnostics('child', child)).toMatchObject({
      fullWindowTokens: 1_000_000,
      policyWindowTokens: 128_000,
      reservedTokens: 16_384,
      ceilingTokens: 111_616,
      checkpointAtTokens: 94_873,
    })
    // Depth 2 and below: 64k.
    expect(resolveContextBudgetFrame({ contextWindow: 1_000_000, depth: 3 }).effectiveWindow).toBe(
      64_000,
    )
    // A model smaller than the cap keeps its own window.
    expect(resolveContextBudgetFrame({ contextWindow: 32_000, depth: 1 }).effectiveWindow).toBe(
      22_400,
    )
  })
})
