/**
 * RunTurnState: the explicit mutable state of ONE agent run — the former ~15
 * closure variables of run() as plain data, plus small pure helpers. No I/O.
 */
import type { AgentStopReason } from '@localixai/agent/agents'
import type { MessageTiming } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db'
import type { emptySessionTiming } from '../../session-timing'
import { normalizeUsage, zeroUsageTotals, type RunUsageTotals } from '../usage-normalize'

export type SessionTimingAggregate = ReturnType<typeof emptySessionTiming>

export type ContextEstimateSource = 'provider_anchor' | 'heuristic'

/** Metadata-only comparison of one pre-call estimate against the provider's count. */
export interface ContextEstimateDrift {
  estimatedTokens: number
  measuredTokens: number
  source: ContextEstimateSource
  /** `estimated / measured`; below 1 means the estimate UNDER-counted the request. */
  ratio: number
}

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

export interface RunTurnState {
  /** The streaming assistant payload (loop-owned). */
  payload: StoredMessagePayload
  /**
   * Per-run payload ref so background jobs can update the message after
   * tool_execution_end. Kept in sync with `payload` by the loop; updated
   * independently by emitBackground.
   */
  currentPayload: StoredMessagePayload
  assistantCreatedAt: string
  /** Last fully-settled PI turn, captured after all of its tool results. */
  completedTurnCheckpoint: { payload: StoredMessagePayload; createdAt: string } | undefined
  /** Most recent fully persisted tool-result turn. A child report can only join this seam. */
  completedToolTurnIndex: number | undefined

  // ---- Timing telemetry -----------------------------------------------
  // Date.now() stamped at each event arrival (the loop processes events
  // serially). modelMs/toolMs/hitlMs sum directly; idleMs is the residual.
  timing: MessageTiming
  runStartedAt: number
  turnStartedAt: number
  /** Per-turn marker (reset on turn_start): time of first token (any kind). */
  turnFirstTokenAt: number | undefined
  /** Per-turn marker: time the model began emitting tool-call arguments. */
  turnToolGenAt: number | undefined
  toolStartTimes: Map<string, number>
  /** HITL waits still open when the tool ends (`ask`-style: the tool IS the wait). */
  hitlStartTimes: Map<string, number>
  /**
   * HITL waits that already CLOSED before the tool ran — a permission card answered, then
   * the tool executed. Booked on tool end beside the open ones, so an approval wait never
   * reads as tool time.
   */
  hitlWaitedMs: Map<string, number>
  /** Aggregate from previously-timed messages (excludes this assistant message). */
  baseSessionTiming: SessionTimingAggregate

  // ---- Usage / cost provenance ------------------------------------------
  usageTotals: RunUsageTotals
  /** Sum of the provider's ACTUAL per-turn costs (when reported). */
  actualCostSum: number
  /** Sum of catalog estimates priced per request (required for tiered pricing). */
  estimatedCostSum: number
  turnsWithUsage: number
  turnsWithActualCost: number
  /**
   * Context size (input + output) of the most recent usage-bearing turn — the
   * provider's real per-REQUEST count, unlike `usageTotals` which sums every
   * turn of the run. Persisted as `usage.contextTokens`: the next turn's checkpoint
   * decision (`model-view/view.ts`) and admission estimate anchor on it.
   */
  lastTurnContextTokens: number | undefined
  /**
   * Pre-call estimate of the FIRST request of this run, with its provenance. Set by
   * the caller that computed it; compared once against the provider's real count.
   */
  initialContextEstimate: { tokens: number; source: ContextEstimateSource } | undefined
  /**
   * Accuracy of that estimate, measured on the first usage-bearing turn — the only
   * turn whose provider count describes the same request the estimate did.
   *
   * The byte heuristic that gates admission has never been checked against a real
   * tokenizer, so its error is unknown in both size and direction. Recording it turns
   * "the divisor is probably wrong for code" into something answerable from real
   * sessions instead of reasoning.
   */
  contextEstimateDrift: ContextEstimateDrift | undefined

  // ---- Loop bookkeeping ---------------------------------------------------
  pendingTools: Map<string, { name: string; input: unknown }>
  currentTurnIndex: number
  /**
   * First model turn created only to repair a missing required `conversation_control` call.
   * Text emitted from this boundary is settled to one public draft before the row
   * becomes visible; ordinary tool-loop turns keep their full narrative history.
   */
  conversationControlRepairTurn: number | undefined
  /** Current provider message text, folded directly from engine-neutral deltas. */
  currentTurnText: string
  /** Current provider message reasoning, folded directly from engine-neutral deltas. */
  currentTurnReasoning: string
  /** Tool executions started across the WHOLE run — 0 = pure narration (no work). */
  toolCallsThisRun: number
  /** An approved configuration change requires a fresh registry before work can continue. */
  configurationReloadPending: boolean
  /**
   * Why the agent loop ended (from the terminal `agent_end` event). Anything other
   * than a normal ending means a no-progress guard or the turn budget cut the run
   * short — the finalizer turns that into a visible notice (see stop-notice.ts).
   * `undefined` when the loop threw before reaching `agent_end`.
   */
  stopReason: AgentStopReason | undefined
  /** Wall time of the last mid-turn DB flush (see STREAM_DB_FLUSH_MS). */
  lastDbFlushAt: number
  /**
   * What the UI last received, so a streaming tick can emit a cheap
   * `message.delta` (trailing text/reasoning append + per-item string appends)
   * instead of the full cumulative snapshot when nothing structural changed.
   * `items` is the last-published items array — the accumulator preserves the
   * object identity of untouched items, so the delta diff is mostly reference
   * compares. `textItemId`/`reasoningItemId` pin the current turn's items.
   * Reset to the published payload on every full snapshot (the delta resync
   * point).
   */
  lastSent: {
    text: string
    reasoning: string
    items: StoredMessagePayload['items']
    textItemId: string
    reasoningItemId: string
  }

  // ---- Provider / key tracking ---------------------------------------------
  /** The key used for this run (first enabled key by priority). */
  usedKeyId: string | undefined
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
    conversationControlRepairTurn: undefined,
    currentTurnText: '',
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

/** Provider-reported per-turn generation timings (subset of AssistantMessage.genTimings). */
export interface TurnGenTimings {
  providerReadMs: number
  ttftMs: number
  toolGenMs: number
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
