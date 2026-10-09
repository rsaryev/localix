/** Type-only state and telemetry contracts for one agent run. */
import type { AgentStopReason } from '@localixai/agent/agents'
import type { MessageTiming } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db'
import type { emptySessionTiming } from '../../session-timing'
import type { RunUsageTotals } from '../usage-normalize'
import type { ContextTokenEstimate } from '../context-usage-anchor'

export type SessionTimingAggregate = ReturnType<typeof emptySessionTiming>

export type ContextEstimateSource = ContextTokenEstimate['source']

/** Metadata-only comparison of one pre-call estimate against the provider's count. */
export interface ContextEstimateDrift {
  estimatedTokens: number
  measuredTokens: number
  source: ContextEstimateSource
  /** `estimated / measured`; below 1 means the estimate UNDER-counted the request. */
  ratio: number
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
  /** Host-consumed turn boundary; steering may not split ahead of the event writer. */
  completedTurnIndex: number | undefined

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

/** Provider-reported per-turn generation timings (subset of AssistantMessage.genTimings). */
export interface TurnGenTimings {
  providerReadMs: number
  ttftMs: number
  toolGenMs: number
}
