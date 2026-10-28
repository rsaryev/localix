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
import {
  markForkCacheAnchor,
  markHistoryCacheAnchor,
  toModelMessages,
} from '@localixai/agent/agents/chat'
import { runHistoryStages } from '@localixai/agent/history'
import {
  estimateChatMessageTokens,
  type CheckpointReason,
  type ContextCheckpoint,
} from '@localixai/agent'

import type { PersistedMessage } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db/payload'
import { assertFixedOverheadFits, type ContextBudgetFrame } from '../context-budget'
import { createContextAnchorIdentity, lastTurnContextAnchor } from '../context-token-estimate'
import { composeTurnContext } from '../model-view/turn-context'
import { modelViewSections } from '../model-view/sections'
import { rowsAfterClear } from '../model-view/view'
import type { ChatTurnFrame } from './frame'
import { clearCutStage, turnContextStage } from './stages/persisted'
import { agentHistoryStage } from './stages/agent-history'
import { findActiveInvocationIndex, toModelPayloads } from './stages/media'
import { checkpointStage } from './stages/checkpoint'
import { admissionStage, preflightStage, type BudgetScratch } from './stages/budget'
import { createRequestTransform } from './request-transform'
import type {
  ChatHistoryRun,
  ChatHistoryRunContext,
  ChatMaterializeResult,
} from './chat-strategy-types'

export type {
  ChatHistoryRun,
  ChatHistoryRunContext,
  ChatMaterializeResult,
  ForkHistory,
} from './chat-strategy-types'

/**
 * The ordered stage names — the contract `scripts/history-strategy-guard.test.ts` pins against
 * the stage files and the docs. Read from SOURCE by that guard, hence `@public` for knip.
 * @public
 */
export const CHAT_STAGES = [
  'clear-cut',
  'agent-history',
  'turn-context',
  'media',
  'checkpoint',
  'preflight',
  'admission',
] as const

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
    })
    // A checkpoint starts a new view, and a new view's runtime context is complete. A fork's
    // first request adds none: its parent's was sent already, and a second one would sit
    // before the end of what the provider has cached.
    const turnContext = ctx.fork?.first
      ? undefined
      : composeTurnContext({
          sections: [...frame.runtimeSections, ...viewSections],
          bindings: frame.systemBindings,
          previous: due ? undefined : ctx.view.previous,
        })

    // ---- Pipeline A: persisted rows ------------------------------------------------
    const persisted = await runHistoryStages(
      frame.messages,
      [
        clearCutStage(),
        // Before anything measures or compresses: the agent's own rows as its model reads them.
        // Every stage after it reasons about what the MODEL sees.
        agentHistoryStage(ctx.availableTools),
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
    const modelMessages = toModelMessages(wirePayloads)
    const wire = (
      ctx.fork?.first
        ? markForkCacheAnchor(modelMessages, ctx.fork.toolCallId)
        : markHistoryCacheAnchor(modelMessages)
    ) as AgentMessage[]
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
