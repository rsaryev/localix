/**
 * Initialization and timing/usage helpers for one mutable agent-run state.
 * State contracts remain re-exported here for the runtime's existing callers.
 */
import type { StoredMessagePayload } from '../../../../db'
import { normalizeUsage, zeroUsageTotals } from '../usage-normalize'
import type {
  SessionTimingAggregate,
  ContextEstimateSource,
  ContextEstimateDrift,
  RunTurnState,
  TurnGenTimings,
} from './turn-state-contracts'
export type {
  SessionTimingAggregate,
  ContextEstimateSource,
  ContextEstimateDrift,
  RunTurnState,
  TurnGenTimings,
} from './turn-state-contracts'

/**
 * Compare a pre-call estimate with the provider's measured input tokens.
 *
 * Returns undefined when there is nothing to learn: no estimate, or a measurement of
 * zero (a usage-less turn), rather than reporting an infinite or zero ratio that would
 * poison any aggregate built from these.
 */
export function computeContextEstimateDrift(
  estimate: { tokens: number; source: ContextEstimateSource } | undefined,
  measuredInputTokens: number,
): ContextEstimateDrift | undefined {
  if (!estimate || !Number.isFinite(estimate.tokens) || estimate.tokens <= 0) return undefined
  if (!Number.isFinite(measuredInputTokens) || measuredInputTokens <= 0) return undefined
  const estimatedTokens = Math.floor(estimate.tokens)
  const measuredTokens = Math.floor(measuredInputTokens)
  return {
    estimatedTokens,
    measuredTokens,
    source: estimate.source,
    ratio: Math.round((estimatedTokens / measuredTokens) * 1000) / 1000,
  }
}

export function createRunTurnState(init: {
  payload: StoredMessagePayload
  assistantCreatedAt: string
  baseSessionTiming: SessionTimingAggregate
}): RunTurnState {
  const runStartedAt = Date.now()
  return {
    payload: init.payload,
    currentPayload: init.payload,
    assistantCreatedAt: init.assistantCreatedAt,
    completedTurnCheckpoint: undefined,
    completedToolTurnIndex: undefined,
    completedTurnIndex: undefined,
    timing: {
      modelMs: 0,
      revealMs: 0,
      ttftMs: undefined,
      toolGenMs: 0,
      waitMs: 0,
      toolMs: 0,
      hitlMs: 0,
      idleMs: 0,
      totalMs: 0,
      turns: 0,
      tools: [],
    },
    runStartedAt,
    turnStartedAt: runStartedAt,
    turnFirstTokenAt: undefined,
    turnToolGenAt: undefined,
    toolStartTimes: new Map(),
    hitlStartTimes: new Map(),
    hitlWaitedMs: new Map(),
    baseSessionTiming: init.baseSessionTiming,
    usageTotals: zeroUsageTotals(),
    actualCostSum: 0,
    estimatedCostSum: 0,
    turnsWithUsage: 0,
    turnsWithActualCost: 0,
    lastTurnContextTokens: undefined,
    initialContextEstimate: undefined,
    contextEstimateDrift: undefined,
    pendingTools: new Map(),
    currentTurnIndex: 0,
    currentTurnText: '',
    currentTurnTextIndex: undefined,
    currentTurnReasoning: '',
    toolCallsThisRun: 0,
    configurationReloadPending: false,
    stopReason: undefined,
    lastDbFlushAt: 0,
    lastSent: {
      text: '',
      reasoning: '',
      items: undefined,
      textItemId: '',
      reasoningItemId: '',
    },
    usedKeyId: undefined,
  }
}

/**
 * Replace the streaming payload's `items` with the accumulator's latest list and
 * keep `currentPayload` (the ref background jobs read) pointed at the same object.
 * Returns the new payload so the caller can flush/publish it.
 */
export function setItemsPayload(
  state: RunTurnState,
  items: StoredMessagePayload['items'],
): StoredMessagePayload {
  state.payload = { ...state.payload, items }
  state.currentPayload = state.payload
  return state.payload
}

/**
 * Fold one turn's wall-clock + provider timings into the run's timing totals
 * (message_end). When the provider reports genTimings, attribute true model
 * time vs cosmetic stream-reveal overhead; otherwise fall back to the per-turn
 * wall markers captured during the stream.
 */
export function foldTurnTiming(
  state: RunTurnState,
  gt: TurnGenTimings | undefined,
  turnEndedAt: number,
): void {
  const wallTurnMs = turnEndedAt - state.turnStartedAt
  if (gt) {
    // True provider time (excludes stream-smoothing reveal). The gap
    // between wall time and provider time is cosmetic reveal overhead.
    state.timing.modelMs += gt.providerReadMs
    state.timing.revealMs += Math.max(0, wallTurnMs - gt.providerReadMs)
    state.timing.waitMs += gt.ttftMs
    state.timing.toolGenMs += gt.toolGenMs
    if (state.timing.ttftMs === undefined) state.timing.ttftMs = gt.ttftMs
    return
  }
  // Fallback: wall-clock timing from per-turn markers.
  state.timing.modelMs += wallTurnMs
  if (state.turnFirstTokenAt !== undefined) {
    state.timing.waitMs += Math.max(0, state.turnFirstTokenAt - state.turnStartedAt)
    if (state.timing.ttftMs === undefined)
      state.timing.ttftMs = state.turnFirstTokenAt - state.runStartedAt
  }
  if (state.turnToolGenAt !== undefined) {
    state.timing.toolGenMs += Math.max(0, Math.min(turnEndedAt - state.turnToolGenAt, wallTurnMs))
  }
}

/** Recompute totalMs and the idle residual from the summed components. */
export function finalizeTiming(state: RunTurnState): void {
  const t = state.timing
  t.totalMs = Date.now() - state.runStartedAt
  t.idleMs = Math.max(0, t.totalMs - t.modelMs - t.revealMs - t.toolMs - t.hitlMs)
}

/** Fold one turn's provider usage into the run totals (message_end). */
export function accumulateTurnUsage(
  state: RunTurnState,
  usage: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cacheWrite1hTokens?: number
    totalTokens?: number
    costSource?: string
    totalCost?: number
  },
  estimatedCost?: number,
): void {
  const totals = state.usageTotals
  const normalized = normalizeUsage(usage)
  totals.inputTokens += normalized.inputTokens
  totals.outputTokens += normalized.outputTokens
  totals.cacheReadTokens += normalized.cacheReadTokens
  totals.cacheWriteTokens += normalized.cacheWriteTokens
  totals.cacheWrite1hTokens += normalized.cacheWrite1hTokens
  totals.reasoningTokens += normalized.reasoningTokens
  totals.totalTokens += normalized.totalTokens
  // The per-REQUEST context anchor: inputTokens is the normalized TOTAL context
  // (non-cached + cacheRead + cacheWrite — see parseUsage in @localixai/agent). A
  // usage-less turn (0 input) keeps the previous anchor rather than clearing it.
  if (normalized.inputTokens > 0) {
    state.lastTurnContextTokens = normalized.inputTokens + normalized.outputTokens
    // Only the FIRST measured turn describes the request the estimate was made for;
    // later turns carry messages the estimate never saw. Set once, never overwritten.
    state.contextEstimateDrift ??= computeContextEstimateDrift(
      state.initialContextEstimate,
      normalized.inputTokens,
    )
  }
  state.turnsWithUsage += 1
  if (typeof estimatedCost === 'number') state.estimatedCostSum += estimatedCost
  if (usage.costSource === 'actual' && typeof usage.totalCost === 'number') {
    state.actualCostSum += usage.totalCost
    state.turnsWithActualCost += 1
  }
}
