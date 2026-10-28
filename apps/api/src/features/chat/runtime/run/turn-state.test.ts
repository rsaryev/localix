import { describe, expect, it } from 'bun:test'
import type { StoredMessagePayload } from '../../../../db'
import { emptySessionTiming } from '../../session-timing'
import {
  accumulateTurnUsage,
  computeContextEstimateDrift,
  createRunTurnState,
  finalizeTiming,
} from './turn-state'
import { settleToolTiming } from './tool-timing'

const newState = () =>
  createRunTurnState({
    payload: {} as StoredMessagePayload,
    assistantCreatedAt: '2026-06-15T00:00:00.000Z',
    baseSessionTiming: emptySessionTiming(),
  })

describe('accumulateTurnUsage', () => {
  it('folds a single turn into the totals', () => {
    const s = newState()
    accumulateTurnUsage(s, {
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cacheWrite1hTokens: 2,
      totalTokens: 140,
    })
    expect(s.usageTotals).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cacheWrite1hTokens: 2,
      reasoningTokens: 0,
      totalTokens: 140,
    })
    expect(s.turnsWithUsage).toBe(1)
  })

  it('sums request-scoped catalog estimates without applying tiers to aggregate tokens', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 10 }, 0.25)
    accumulateTurnUsage(s, { inputTokens: 20 }, 0.5)
    expect(s.estimatedCostSum).toBeCloseTo(0.75, 6)
  })

  it('derives totalTokens from input+output when not provided', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 30, outputTokens: 12 })
    expect(s.usageTotals.totalTokens).toBe(42)
  })

  it('sums across multiple turns and counts them', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    accumulateTurnUsage(s, { inputTokens: 7, outputTokens: 3, totalTokens: 10 })
    expect(s.usageTotals.inputTokens).toBe(17)
    expect(s.usageTotals.outputTokens).toBe(8)
    expect(s.usageTotals.totalTokens).toBe(25)
    expect(s.turnsWithUsage).toBe(2)
  })

  it('tracks the LAST turn context anchor separately from the run sums', () => {
    const s = newState()
    expect(s.lastTurnContextTokens).toBeUndefined()
    accumulateTurnUsage(s, { inputTokens: 1000, outputTokens: 50 })
    accumulateTurnUsage(s, { inputTokens: 1200, outputTokens: 80 })
    // Anchor = the last request's context, NOT the 2330-token run sum.
    expect(s.lastTurnContextTokens).toBe(1280)
    expect(s.usageTotals.inputTokens).toBe(2200)
    // A usage-less turn (0 input) keeps the previous anchor.
    accumulateTurnUsage(s, {})
    expect(s.lastTurnContextTokens).toBe(1280)
  })

  it('accumulates reasoningTokens passed via the extended shape', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 1, outputTokens: 1, reasoningTokens: 99 } as Parameters<
      typeof accumulateTurnUsage
    >[1])
    expect(s.usageTotals.reasoningTokens).toBe(99)
  })

  it('counts actual cost only when costSource is actual AND totalCost is numeric', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 1, costSource: 'actual', totalCost: 0.25 })
    accumulateTurnUsage(s, { inputTokens: 1, costSource: 'estimated', totalCost: 0.5 }) // ignored
    accumulateTurnUsage(s, { inputTokens: 1, costSource: 'actual' }) // no totalCost → ignored
    expect(s.actualCostSum).toBeCloseTo(0.25, 6)
    expect(s.turnsWithActualCost).toBe(1)
    expect(s.turnsWithUsage).toBe(3)
  })
})

describe('finalizeTiming', () => {
  it('clamps idleMs to 0 when the component sum exceeds the elapsed total', () => {
    const s = newState()
    s.timing.modelMs = 1_000_000_000 // far larger than any real elapsed time
    finalizeTiming(s)
    expect(s.timing.idleMs).toBe(0)
    expect(s.timing.totalMs).toBeGreaterThanOrEqual(0)
  })
})

describe('computeContextEstimateDrift', () => {
  it('reports the signed relative error against the provider count', () => {
    expect(computeContextEstimateDrift({ tokens: 8_000, source: 'heuristic' }, 10_000)).toEqual({
      estimatedTokens: 8_000,
      measuredTokens: 10_000,
      source: 'heuristic',
      ratio: 0.8,
    })
    expect(
      computeContextEstimateDrift({ tokens: 12_000, source: 'provider_anchor' }, 10_000)?.ratio,
    ).toBe(1.2)
  })

  it('declines to score what it cannot compare', () => {
    // A usage-less turn or a missing estimate must not surface as a 0 or Infinity
    // ratio — an aggregate built from these would be silently poisoned.
    expect(computeContextEstimateDrift(undefined, 10_000)).toBeUndefined()
    expect(computeContextEstimateDrift({ tokens: 8_000, source: 'heuristic' }, 0)).toBeUndefined()
    expect(computeContextEstimateDrift({ tokens: 0, source: 'heuristic' }, 10_000)).toBeUndefined()
    expect(
      computeContextEstimateDrift({ tokens: Number.NaN, source: 'heuristic' }, 10_000),
    ).toBeUndefined()
  })
})

describe('context estimate drift over a run', () => {
  it('scores the FIRST measured turn and never overwrites it', () => {
    const s = newState()
    s.initialContextEstimate = { tokens: 9_000, source: 'heuristic' }

    accumulateTurnUsage(s, { inputTokens: 10_000, outputTokens: 50 })
    expect(s.contextEstimateDrift).toMatchObject({ measuredTokens: 10_000, ratio: 0.9 })

    // Later turns carry messages the estimate never saw, so scoring them would
    // measure growth rather than accuracy.
    accumulateTurnUsage(s, { inputTokens: 40_000, outputTokens: 50 })
    expect(s.contextEstimateDrift).toMatchObject({ measuredTokens: 10_000, ratio: 0.9 })
  })

  it('stays unscored when the run never reports usage', () => {
    const s = newState()
    s.initialContextEstimate = { tokens: 9_000, source: 'heuristic' }
    accumulateTurnUsage(s, { outputTokens: 20 })
    expect(s.contextEstimateDrift).toBeUndefined()
  })

  it('stays unscored when no estimate was handed over', () => {
    const s = newState()
    accumulateTurnUsage(s, { inputTokens: 10_000 })
    expect(s.contextEstimateDrift).toBeUndefined()
  })
})

describe('settleToolTiming — human waits are never tool time', () => {
  it('books a permission card answered BEFORE the tool ran as HITL, not as the tool', () => {
    // Bash started at t=0, the approval card took 221s, the command itself 12s.
    const s = newState()
    s.toolStartTimes.set('call-1', 0)
    s.hitlWaitedMs.set('call-1', 221_000)
    settleToolTiming(s, 'call-1', 'Bash', 233_000)
    expect(s.timing.hitlMs).toBe(221_000)
    expect(s.timing.toolMs).toBe(12_000)
    expect(s.timing.tools).toEqual([{ toolCallId: 'call-1', toolName: 'Bash', durationMs: 12_000 }])
    expect(s.hitlWaitedMs.size).toBe(0)
  })

  it('an open wait (ask-style tool) still counts to the end, and both kinds add up', () => {
    const s = newState()
    s.toolStartTimes.set('call-2', 1_000)
    s.hitlWaitedMs.set('call-2', 4_000)
    s.hitlStartTimes.set('call-2', 6_000)
    settleToolTiming(s, 'call-2', 'ask', 10_000)
    expect(s.timing.hitlMs).toBe(8_000)
    expect(s.timing.toolMs).toBe(1_000)
  })

  it('a call that never started leaves the clocks untouched but clears its ledger', () => {
    const s = newState()
    s.hitlWaitedMs.set('ghost', 5_000)
    settleToolTiming(s, 'ghost', 'Bash', 9_000)
    expect(s.timing.hitlMs).toBe(0)
    expect(s.timing.tools).toEqual([])
    expect(s.hitlWaitedMs.size).toBe(0)
  })
})
