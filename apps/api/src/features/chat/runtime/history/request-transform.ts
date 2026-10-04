/**
 * The PER-REQUEST half of the chat strategy: a safety net for ONE run that outgrows the window.
 *
 * Between checkpoints the history is append-only, and that includes the requests inside a run:
 * pruning a little on every request would rewrite the prefix — and every thinking block after
 * the first changed byte — on every tool call. So this prunes only once the request reaches the
 * checkpoint high-water mark, in one step (everything recoverable beyond the recent window), and
 * then says so: the measured size of this run no longer describes the history the next turn
 * rebuilds, so the next turn takes a checkpoint.
 *
 * What it also keeps is the LEDGER: which tool results are no longer intact on the wire and
 * which are present. `read`'s "unchanged since your earlier read" stub consults it, so a stale
 * ledger makes the model a promise about content it no longer has.
 *
 * ARITY. The admission offset below is a baseline length measured on the UNPRUNED wire and
 * applied to the pruned one, which is sound only while pruning never changes the message
 * COUNT. `pruneWireMessages` maps element-wise and `prune-wire-arity.test.ts` pins it. A
 * strategy that drops whole messages per request (the strict SKILL.state one) must not reuse
 * this offset trick — it accounts by construction instead.
 */
import type { AgentMessage } from '@localixai/agent/agents'
import {
  calibratedTokens,
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  DEFAULT_TOKEN_CALIBRATION,
  estimateWireMessageSize,
  estimateWireMessageTokens,
  estimateWireSize,
  pruneWireMessages,
  type Message as WireMessage,
  type TokenCalibration,
  type WireSizeSample,
} from '@localixai/agent'
import type { RuntimeContextPolicy } from '@localixai/agent/runtime'

import { MODEL_TRIM_MIN_RECLAIM_TOKENS, resolveKeepRecentTokens } from '../agent-runner-constants'
import { checkpointAtTokens } from '../model-view/checkpoint-policy'
import { dumpWire, wireDumpEnabled } from '../run/wire-dump'
import {
  ActiveTurnTooLargeError,
  LocalContextBudgetExceededError,
  type ContextBudgetFrame,
  type ContextEstimateSource,
} from '../context-budget'

/** The elision ledger the port requires every strategy to keep current. */
export interface ElisionLedger {
  elidedToolCallIds: Set<string>
  elidedArgToolCallIds: Set<string>
  wireResultIds: Set<string>
}

export interface RequestTransformInput {
  sessionId: string
  modelId: string
  frame: ContextBudgetFrame
  /** Trusted/heuristic estimate of the first request after materialization. */
  initialContextTokens?: number
  initialEstimateSource?: ContextEstimateSource
  ledger?: ElisionLedger
  recoveryToolAvailable?: boolean
  /** Called when a request had to be pruned: the next turn must take a checkpoint. */
  onPruned?: () => void
  /**
   * What the provider has taught about THIS model's real cost of heuristic text and images.
   * Prices the messages a run appends after its measured prefix; the prefix itself is scaled
   * by its own measurement. Default: uncalibrated.
   */
  calibration?: TokenCalibration
}

/** The per-request policy plus the sample its host needs to keep the calibration learning. */
export interface RequestTransformPolicy extends RuntimeContextPolicy {
  /** Size of the wire most recently handed to the provider — the request its next usage measures. */
  lastWireSample(): WireSizeSample | undefined
}

function sumTokens(messages: readonly WireMessage[], from = 0, to = messages.length): number {
  let total = 0
  for (let i = from; i < to; i++)
    total += estimateWireMessageTokens(messages[i] as WireMessage & object)
  return total
}

export function createRequestTransform(input: RequestTransformInput): RequestTransformPolicy {
  const { frame } = input
  const calibration = input.calibration ?? DEFAULT_TOKEN_CALIBRATION
  let lastWireSample: WireSizeSample | undefined
  const initialContextTokens =
    typeof input.initialContextTokens === 'number' &&
    Number.isFinite(input.initialContextTokens) &&
    input.initialContextTokens > 0
      ? Math.floor(input.initialContextTokens)
      : undefined
  // The baseline: the first request's wire, kept both serialized (for a content compare) and
  // by reference (unchanged messages cost one pointer compare, not a re-serialization).
  let baselineWire: string[] | undefined
  let baselineRefs: readonly WireMessage[] | undefined

  return {
    lastWireSample: () => lastWireSample,
    async transform(
      messages: readonly AgentMessage[],
      signal: AbortSignal,
    ): Promise<AgentMessage[]> {
      signal.throwIfAborted()
      const wire = messages as WireMessage[]
      if (!baselineWire) {
        baselineWire = wire.map((m) => JSON.stringify(m))
        baselineRefs = wire.slice()
      }
      // Only a PROVIDER figure anchors the prefix. A heuristic initial estimate is the same
      // arithmetic this policy would do itself, so treating it as a measurement would only
      // exempt the prefix from the learned calibration.
      const prefixIsStable =
        initialContextTokens !== undefined &&
        input.initialEstimateSource === 'provider_anchor' &&
        baselineWire.length <= wire.length &&
        baselineWire.every(
          (serialized, i) =>
            baselineRefs?.[i] === wire[i] || serialized === JSON.stringify(wire[i]),
        )
      // Pi's measured-prefix + trailing-estimate pattern, shared with pruning.
      // Calibrate ONLY the known prefix. A signed global correction can erase
      // new tool-output cost once pruning reclaims more than the old measurement.
      const baselineTokens = prefixIsStable ? sumTokens(wire, 0, baselineWire.length) : 0
      const scale =
        prefixIsStable && baselineTokens > 0
          ? Math.min(1, Math.max(0, initialContextTokens - frame.fixedOverhead) / baselineTokens)
          : 1
      // A prefix message is scaled by ITS measurement; an appended one by what this model has
      // taught about text and images so far (a learned per-model cost).
      const estimateMessageTokens = (message: WireMessage, index: number) =>
        prefixIsStable && index < baselineWire!.length
          ? Math.floor(estimateWireMessageTokens(message) * scale)
          : calibratedTokens(estimateWireMessageSize(message), calibration)
      const pruningFixedOverhead = prefixIsStable
        ? initialContextTokens -
          wire
            .slice(0, baselineWire.length)
            .reduce((sum, message, index) => sum + estimateMessageTokens(message, index), 0)
        : frame.fixedOverhead

      // The per-result size bounds apply on every request, identically, so they never change a
      // byte between requests; only a prune past the pressure gate rewrites the prefix.
      const pressureTokens = checkpointAtTokens(frame)
      const underPressure =
        pruningFixedOverhead +
          wire.reduce((sum, message, index) => sum + estimateMessageTokens(message, index), 0) >=
        pressureTokens
      const pruned = pruneWireMessages(wire, {
        recoveryToolAvailable: input.recoveryToolAvailable,
        keepRecentTokens: resolveKeepRecentTokens(frame.effectiveWindow),
        minReclaimTokens: MODEL_TRIM_MIN_RECLAIM_TOKENS,
        // The whole-request TRIGGER: the prune sums messages PLUS overhead and compares to
        // this. The history allowance here would subtract the overhead twice.
        budgetTokens: frame.trigger,
        // Append-only below the high-water mark: the prune is a safety net, not a policy.
        pressureTokens,
        fixedOverheadTokens: pruningFixedOverhead,
        estimateMessageTokens,
        ...(input.ledger?.elidedToolCallIds.size
          ? { elidedToolCallIds: input.ledger.elidedToolCallIds }
          : {}),
        ...(input.ledger?.elidedArgToolCallIds.size
          ? { elidedArgToolCallIds: input.ledger.elidedArgToolCallIds }
          : {}),
      }) as WireMessage[]

      // An anchor measures the old prefix. Once pruning rewrites it, charge the pruned
      // wire plus its inferred overhead; keeping the old total would reject a request
      // that the pruner just made fit. That revised estimate is heuristic, not measured.
      const prefixWasPruned =
        prefixIsStable &&
        pruned
          .slice(0, baselineWire.length)
          .some((message, i) => message !== wire[i] && JSON.stringify(message) !== baselineWire![i])
      if (underPressure && pruned.some((message, i) => message !== wire[i])) input.onPruned?.()
      const anchorApplies = prefixIsStable && !prefixWasPruned
      const estimated = anchorApplies
        ? initialContextTokens +
          pruned
            .slice(baselineWire.length)
            .reduce(
              (sum, message, i) => sum + estimateMessageTokens(message, baselineWire!.length + i),
              0,
            )
        : pruningFixedOverhead +
          pruned.reduce((sum, message, index) => sum + estimateMessageTokens(message, index), 0)
      if (estimated > frame.trigger) {
        const baselineHasCompactable =
          prefixIsStable &&
          baselineRefs?.some((m) => m.role === 'assistant' || m.role === 'tool') === true
        const appendedActiveTurn =
          prefixIsStable && wire.length > baselineWire.length && !baselineHasCompactable
        const common = {
          frame,
          requiredTokens: estimated,
          availableTokens: frame.trigger,
          estimateSource: anchorApplies
            ? (input.initialEstimateSource ?? 'heuristic')
            : 'heuristic',
        } as const
        if (appendedActiveTurn) {
          throw new ActiveTurnTooLargeError({
            ...common,
            message:
              `The active tool turn still requires ${estimated} tokens after wire pruning, ` +
              `above its ${frame.trigger}-token request budget. Stop broad tool calls, ` +
              'narrow or split the task, and continue from the stored tool-output pointers.',
          })
        }
        throw new LocalContextBudgetExceededError({
          ...common,
          reason: 'estimated_context_too_large',
          message:
            `Local context policy estimates this request at ${estimated} tokens after wire pruning, ` +
            `above its ${frame.trigger}-token request budget. ` +
            'Compact older history or switch to a model with a larger input capacity.',
        })
      }

      if (input.ledger) {
        for (const id of collectElidedToolCallIds(pruned)) input.ledger.elidedToolCallIds.add(id)
        for (const id of collectElidedArgToolCallIds(pruned))
          input.ledger.elidedArgToolCallIds.add(id)
        input.ledger.wireResultIds.clear()
        for (const m of pruned) {
          if (m.role !== 'tool') continue
          for (const r of m.results) if (r.toolCallId) input.ledger.wireResultIds.add(r.toolCallId)
        }
      }
      if (wireDumpEnabled()) dumpWire(input.sessionId, input.modelId, pruned)
      lastWireSample = estimateWireSize(pruned)
      return pruned as AgentMessage[]
    },
  }
}
