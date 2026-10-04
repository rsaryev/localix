/**
 * `chat-hybrid`: the history strategy for every run.
 *
 * The conversation is kept whole in the transcript and shown to the model through a frozen
 * VIEW. Between context checkpoints the view is append-only: the same rows give the same bytes
 * on every turn, which keeps the provider's prefix cache and the model's preserved thinking
 * intact. On the turn a checkpoint is due the view is re-planned once — observations masked,
 * long answers folded, and only then the oldest turns evicted into epoch cards — without a
 * model call, and the new record is handed back for the run to persist before it sends.
 *
 * One strategy, two halves over ONE budget frame:
 *
 *   materialize (per turn)       — persisted rows → the wire the run starts from, through the
 *                                  stages below in order;
 *   requestPolicy (per request)  — a safety net inside the run: it prunes only near the ceiling,
 *                                  and a prune asks the next turn for a checkpoint.
 *
 * The stage list is the contract. `history-strategy-guard.test.ts` pins it as a set against
 * the stage files, both directions, the way the stream contract is pinned.
 */
import type { AgentMessage } from '@localixai/agent/agents'
import { markHistoryCacheAnchor, toModelMessages } from '@localixai/agent/agents/chat'
import { runHistoryStages, type StageReport } from '@localixai/agent/history'
import type { RuntimeContextPolicy } from '@localixai/agent/runtime'
import {
  estimateChatMessageTokens,
  type CheckpointReason,
  type ContextCheckpoint,
  type TokenCalibration,
  type WireSizeSample,
} from '@localixai/agent'

import type { PersistedMessage } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db/payload'
import type { MediaStore } from '../../../media/store'
import type { DocumentTextExtractor } from '../../../agent-core/tools/file/document-ports'
import { assertFixedOverheadFits, type ContextBudgetFrame } from '../context-budget'
import {
  createContextAnchorIdentity,
  lastTurnContextAnchor,
  type ContextAnchorIdentity,
  type ContextAnchorProof,
} from '../context-token-estimate'
import { composeTurnContext, type StoredTurnContext } from '../model-view/turn-context'
import { modelViewSections } from '../model-view/sections'
import { rowsAfterClear, type ModelView } from '../model-view/view'
import type { ChatTurnFrame } from './frame'
import { clearCutStage, turnContextStage } from './stages/persisted'
import { participantViewStage, type ParticipantAudience } from './stages/participant-view'
import { findActiveInvocationIndex, toModelPayloads } from './stages/media'
import { checkpointStage } from './stages/checkpoint'
import { admissionStage, preflightStage, type BudgetScratch } from './stages/budget'
import { createRequestTransform, type ElisionLedger } from './request-transform'

/**
 * The ordered stage names — the contract `scripts/history-strategy-guard.test.ts` pins against
 * the stage files and the docs. Read from SOURCE by that guard, hence `@public` for knip.
 * @public
 */
export const CHAT_STAGES = [
  'clear-cut',
  'participant-view',
  'turn-context',
  'media',
  'checkpoint',
  'preflight',
  'admission',
] as const

export interface ChatHistoryRunContext {
  sessionId: string
  frame: ContextBudgetFrame
  /** For the anchor identity: which provider/model, and the hashes of the fixed prefix. */
  identity: {
    providerId: string
    modelId: string
    systemPromptHash: string
    toolSchemaHash: string
  }
  /**
   * WHOSE VIEW of the conversation this run reads: the speaking participant, plus what it can
   * actually do this turn. Production runs supply this even with one current participant:
   * the shared transcript can still contain a former participant's private tool work.
   */
  participantAudience?: ParticipantAudience
  /** The frozen view in force and whether this turn re-plans it (`model-view/view.ts`). */
  view: ModelView
  recoveryToolAvailable?: boolean
  /** Is `history_search` in the roster? Cards and folds point at it only when it is. */
  recallToolAvailable?: boolean
  /** Is `memory` in the roster? The checkpoint warning asks the agent to save with it. */
  memoryToolAvailable?: boolean
  /** What this model has taught about the heuristic so far; prices appended messages. */
  calibration?: TokenCalibration
  media: {
    mediaStore?: MediaStore
    defaultCwd?: string
    extractDocument?: DocumentTextExtractor
    acceptsImages?: boolean
  }
  /** Session-scoped state, owned by the host and reused across runs. */
  state: {
    contextAnchorProof?: ContextAnchorProof
    /** Set by the per-request policy when it had to prune; the next turn checkpoints. */
    checkpointDue?: CheckpointReason
  } & ElisionLedger
}

export interface ChatMaterializeResult {
  wire: AgentMessage[]
  /** The bounded persisted history the wire was derived from (the finalizer reads it). */
  effectiveHistory: PersistedMessage[]
  payloads: StoredMessagePayload[]
  estimate: { tokens: number; source: 'provider_anchor' | 'heuristic'; trailingTokens?: number }
  identity: ContextAnchorIdentity
  reports: StageReport[]
  /** This turn's runtime context, for the run to persist on its assistant row. */
  turnContext?: StoredTurnContext
  /** The checkpoint this turn took, for the run to persist before it sends. */
  checkpoint?: ContextCheckpoint
}

/** One run's history handling: both halves over one frame. */
export interface ChatHistoryRun {
  materialize(frame: ChatTurnFrame, signal: AbortSignal): Promise<ChatMaterializeResult>
  requestPolicy(init: {
    initialEstimate: ChatMaterializeResult['estimate']
  }): RuntimeContextPolicy & {
    /** The wire the provider's next usage will measure. */
    lastWireSample?: () => WireSizeSample | undefined
  }
}

export function createChatHistoryRun(ctx: ChatHistoryRunContext): ChatHistoryRun {
  assertFixedOverheadFits(ctx.frame)
  const flags = {
    recoveryToolAvailable: ctx.recoveryToolAvailable !== false,
    recallToolAvailable: ctx.recallToolAvailable === true,
  }

  async function build(
    frame: ChatTurnFrame,
    due: CheckpointReason | undefined,
    signal: AbortSignal,
  ): Promise<{ result: ChatMaterializeResult; overCeiling: boolean }> {
    const viewSections = modelViewSections({
      view: ctx.view,
      rows: rowsAfterClear(frame.messages).rows,
      prompt: frame.promptMessage,
      tools: { recall: flags.recallToolAvailable, memory: ctx.memoryToolAvailable === true },
    })
    // A checkpoint starts a new view, and a new view's runtime context is complete.
    const turnContext = composeTurnContext({
      sections: [...frame.runtimeSections, ...viewSections],
      bindings: frame.systemBindings,
      previous: due ? undefined : ctx.view.previous,
    })

    // ---- Pipeline A: persisted rows ------------------------------------------------
    const persisted = await runHistoryStages(
      frame.messages,
      [
        clearCutStage(),
        // Before anything measures or compresses: rewrite authorship into the speaking
        // participant's point of view. Every stage after it reasons about what the MODEL sees.
        participantViewStage(ctx.participantAudience),
        turnContextStage({
          past: ctx.view.turnContexts,
          ...(turnContext
            ? {
                current: {
                  context: turnContext,
                  owner: {
                    id: frame.assistantMessageId,
                    sessionId: frame.sessionId,
                    userId: frame.userId,
                    createdAt: frame.assistantCreatedAt,
                  },
                },
              }
            : {}),
        }),
      ],
      stageBudget(ctx.frame, signal, (row: PersistedMessage) => row.payload),
    )
    const effectiveHistory = persisted.messages as PersistedMessage[]

    // ---- The seam: rows → model payloads, with media resolved -----------------------
    const activeInvocationIndex = findActiveInvocationIndex(
      effectiveHistory,
      frame.activeInvocationId,
    )
    const inForce = due ? undefined : ctx.view.checkpoint?.record
    const payloads = await toModelPayloads(effectiveHistory, {
      ...ctx.media,
      ...(inForce
        ? {
            collapsedToolResult: (messageId: string, toolCallId: string) =>
              inForce.transforms[messageId]?.supersededItemIds?.includes(toolCallId) === true,
          }
        : {}),
    })

    // ---- Pipeline B: payloads through the view, under the budget ----------------------
    const identity = createContextAnchorIdentity({
      providerId: ctx.identity.providerId,
      modelId: ctx.identity.modelId,
      boundaryId: due ? frame.assistantMessageId : ctx.view.epochId,
      systemPromptHash: ctx.identity.systemPromptHash,
      toolSchemaHash: ctx.identity.toolSchemaHash,
      fixedOverheadTokens: ctx.frame.fixedOverhead,
    })
    let checkpoint: ContextCheckpoint | undefined
    const scratch: BudgetScratch = {
      frame: ctx.frame,
      ...(frame.activeInvocationId ? { activeInvocationId: frame.activeInvocationId } : {}),
      anchor: lastTurnContextAnchor(effectiveHistory, ctx.state.contextAnchorProof),
      identity,
      checkpointed: due !== undefined,
    }
    const fitted = await runHistoryStages(
      payloads,
      [
        checkpointStage({
          frame: ctx.frame,
          rows: effectiveHistory,
          ...(ctx.view.checkpoint ? { inForce: ctx.view.checkpoint } : {}),
          ...(due ? { due: { reason: due, hostId: frame.assistantMessageId } } : {}),
          endsWithTurnContext: turnContext !== undefined,
          activeInvocationIndex,
          flags,
          onCheckpoint: (taken) => {
            checkpoint = taken
          },
        }),
        preflightStage(scratch),
        admissionStage(scratch),
      ],
      stageBudget(ctx.frame, signal, (payload: StoredMessagePayload) => payload),
    )
    const wirePayloads = fitted.messages as StoredMessagePayload[]
    const wire = markHistoryCacheAnchor(toModelMessages(wirePayloads)) as AgentMessage[]
    return {
      result: {
        wire,
        effectiveHistory,
        payloads: wirePayloads,
        estimate: scratch.estimate!,
        identity,
        reports: [...persisted.reports, ...fitted.reports],
        ...(turnContext ? { turnContext } : {}),
        ...(checkpoint ? { checkpoint } : {}),
      },
      overCeiling: scratch.overCeiling === true,
    }
  }

  return {
    async materialize(frame: ChatTurnFrame, signal: AbortSignal): Promise<ChatMaterializeResult> {
      const first = await build(frame, ctx.view.due, signal)
      // A view that does not fit and took no checkpoint takes one now — the measured-size
      // decision could not see it (a smaller model, a history no provider has measured yet).
      return first.overCeiling ? (await build(frame, 'ceiling', signal)).result : first.result
    },

    requestPolicy(init: { initialEstimate: ChatMaterializeResult['estimate'] }) {
      return createRequestTransform({
        sessionId: ctx.sessionId,
        modelId: ctx.identity.modelId,
        frame: ctx.frame,
        initialContextTokens: init.initialEstimate.tokens,
        initialEstimateSource: init.initialEstimate.source,
        ledger: ctx.state,
        recoveryToolAvailable: ctx.recoveryToolAvailable,
        onPruned: () => {
          ctx.state.checkpointDue = 'ceiling'
        },
        ...(ctx.calibration ? { calibration: ctx.calibration } : {}),
      })
    },
  }
}

/** ONE budget for both pipelines, which differ only in how a message reaches its payload. */
function stageBudget<T>(
  frame: ContextBudgetFrame,
  signal: AbortSignal,
  payloadOf: (message: T) => StoredMessagePayload,
) {
  return {
    budgetTokens: frame.historyBudget,
    estimate: (messages: readonly unknown[]) =>
      (messages as T[]).reduce((n, m) => n + estimateChatMessageTokens(payloadOf(m)), 0),
    signal,
  }
}
