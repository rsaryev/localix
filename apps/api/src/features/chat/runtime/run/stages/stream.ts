/**
 * Stage 8 — stream: call the model and fold its events into the assistant row.
 *
 * Everything the adapter needs mid-run is wired here and nowhere later, because once the
 * stream is open the only way back into the run is through these callbacks: steering (user
 * messages and mid-run reminders), the permission gate, the refusal-storm stop, output
 * externalization, and the follow-up that repairs a multi-agent turn missing its required
 * `conversation_control` call. A run that ends without that call is an error rather than a
 * quiet success, because the room would otherwise wait for a handoff that never comes.
 */
import {
  DEFAULT_TOKEN_CALIBRATION,
  observeTokenCalibration,
  type SteeringBoundary,
} from '@localixai/agent'
import { agentParticipant } from '../../../../../db/participant'

import { midRunInterjectEnabled } from '../../../../agent-core/interjection'
import { completedConversationControl } from '../../../../agent-core/conversation-control-request'
import { TOOL } from '../../../../agent-core/tool-names'
import { buildExternalizeAfterToolCall } from '../../../../context-store/externalize'
import { createContextStoreRepository } from '../../../../context-store/repository'
import { agentRoute } from '../../../session-route'
import { createItemAccumulator } from '../../items'
import { withMidRunReminders } from '../../mid-run-reminders'
import { createRunAsyncRegistry, describeToolActions } from '../async-registry'
import { handleAgentEvent, type TurnEventContext } from '../event-handlers'
import { createToolCheckpointGate, takeSteeringAtCheckpoint } from '../tool-checkpoint-gate'
import {
  buildRequiredConversationControlFollowUp,
  buildRuntimeSteering,
  buildRuntimeToolContext,
} from '../runtime-execution'
import { requireCompletedRuntime } from '../runtime-result'
import { addressedToSpeaker, createSteeringTaker } from '../steering'
import { indexToolPresentation } from '../tool-assembly'
import type { RunInputs } from './context'
import type { RunFrame } from './frame'
import type { RunHistory } from './history'
import type { RunIntake } from './intake'
import type { RunPrompt } from './prompt'
import type { RunToolset } from './tools'
import type { ResolvedTurn } from './turn'

/**
 * Hard ceiling on per-turn output tokens, independent of a model's (sometimes huge) declared
 * limit — bounds a runaway single-turn response. The loop continues a capped turn through its
 * max_tokens continuation, so this never truncates work.
 */
const ABSOLUTE_MAX_OUTPUT_TOKENS = 32768

export type RunStream = Awaited<ReturnType<typeof streamRun>>

export async function streamRun(
  frame: RunFrame,
  turn: ResolvedTurn,
  inputs: RunInputs,
  toolset: RunToolset,
  prompt: RunPrompt,
  intake: RunIntake,
  history: RunHistory,
) {
  const { env, userId, session, speakerAgentId, assistantMessageId, abort } = frame
  const { deps, repo, state: runtimeState, now } = env
  const { state } = turn
  const { connection, credential, credentialStore, providerId, rawModelId } = turn.model
  const { conversationControl, dispatchTools, tools } = toolset

  // Pi can announce a settled turn before the bounded stream's writer commits it.
  const toolCheckpoint = createToolCheckpointGate({
    signal: abort.signal,
    completedIndex: () => state.completedTurnIndex,
  })
  let requestedToolTurnIndex: number | undefined
  let deliveredToolTurnIndex: number | undefined
  let backgroundAccumulator: ReturnType<typeof createItemAccumulator> | undefined

  const asyncRegistry = createRunAsyncRegistry({
    env,
    state,
    abort,
    userId,
    session,
    agentId: speakerAgentId,
    assistantMessageId,
    backgroundToolNames: toolset.backgroundToolNames,
    recoveryToolAvailable: toolset.recoveryToolAvailable,
    patchLiveItem: (toolCallId, patch) => {
      backgroundAccumulator?.patchToolItem(toolCallId, patch)
    },
  })
  const takeFromQueue =
    midRunInterjectEnabled() && session.sessionKind !== 'system'
      ? createSteeringTaker({
          env,
          repo,
          sessionId: session.id,
          now,
          signal: abort.signal,
          steerCtxRef: frame.steerCtxRef,
          accepts: (content) => addressedToSpeaker(content, session.agents, speakerAgentId),
          ...(session.sessionKind === 'chat'
            ? {
                subagent: {
                  address: {
                    participant: agentParticipant(speakerAgentId),
                    allowUnaddressed: session.agents.length === 1,
                  },
                  canDeliver: () =>
                    requestedToolTurnIndex !== undefined &&
                    requestedToolTurnIndex === state.completedToolTurnIndex &&
                    deliveredToolTurnIndex !== requestedToolTurnIndex,
                  onDelivered: () => {
                    deliveredToolTurnIndex = requestedToolTurnIndex
                  },
                },
              }
            : {}),
        })
      : undefined
  const takeSteering = buildRuntimeSteering({
    takeUserMessages: takeFromQueue
      ? (boundary?: SteeringBoundary) =>
          takeSteeringAtCheckpoint({
            boundary,
            waitFor: toolCheckpoint.waitFor,
            take: takeFromQueue,
            onToolBoundary: (index) => {
              requestedToolTurnIndex = index
            },
          })
      : undefined,
  })
  const speakerRoute = agentRoute(session, speakerAgentId)
  const toolExecutionContext = buildRuntimeToolContext({
    deps,
    userId,
    sessionId: session.id,
    ...(speakerRoute
      ? { speaker: { agentId: speakerRoute.agentId, handle: speakerRoute.handle } }
      : {}),
    asyncRegistry,
    scratchDir: toolset.scratchDir,
    // A prompt reaches a person only when one can be shown AND the session expects one to answer
    // — an autonomous session is the second "no" (`permission-mode-policy.ts`).
    interactive: frame.hitl.reachable && inputs.humanReachable,
  })

  // Ties the next persisted usage measurement to the exact static request envelope about to
  // produce it. A run that yields no usage leaves an anchor whose message id will not match,
  // and the proof is conservatively ignored.
  frame.stores.context.contextAnchorProof = {
    messageId: assistantMessageId,
    identity: history.contextIdentity,
  }
  frame.providerAttemptStarted = true
  const contextPolicy = history.historyRun.requestPolicy({ initialEstimate: history.estimate })
  // Every measured request teaches the model's real cost of the heuristic (text scale, image
  // cost) for the NEXT run's appended messages: the policy remembers the wire it handed over,
  // and the usage that arrives next describes exactly that wire.
  const observeMeasuredContext = (measuredInputTokens: number) => {
    const sample = contextPolicy.lastWireSample?.()
    if (!sample) return
    runtimeState.tokenCalibration.set(
      history.calibrationKey,
      observeTokenCalibration(
        runtimeState.tokenCalibration.get(history.calibrationKey) ?? DEFAULT_TOKEN_CALIBRATION,
        sample,
        measuredInputTokens,
        frame.budget.frame?.fixedOverhead ?? 0,
      ),
    )
  }
  const turnControlDone = () =>
    conversationControl?.completed() === true ||
    completedConversationControl(state.currentPayload.items) !== undefined
  // A synchronous adapter-startup throw needs no wrapper: it lands in the orchestrator's catch,
  // which closes the run row (`fail` is idempotent).
  const stream = deps.agentRuntime.run({
    sessionId: session.id,
    messages: history.wire,
    systemPrompt: prompt.systemPrompt,
    model: { providerId, modelId: rawModelId },
    credential,
    credentialStore,
    reasoningEffort: frame.speakerRoute.reasoningEffort,
    maxOutputTokens: Math.min(
      turn.catalogModel?.outputLimit ?? ABSOLUTE_MAX_OUTPUT_TOKENS,
      ABSOLUTE_MAX_OUTPUT_TOKENS,
    ),
    // The observed idle gap, not a TTL: the adapter owns its provider's cache cost model.
    promptCacheIdleMs: turn.turnIdleMs,
    maxTurns: intake.maxTurns,
    tools,
    // `activate_tools` promotes selected full schemas from this superset into the next turn.
    dispatchTools,
    signal: abort.signal,
    contextPolicy,
    beforeToolCall: intake.permissionGate,
    // A blocked call reaches no tool wrapper and no after-tool hook, so the gate's own memory
    // is the only thing that can notice a run refused over and over.
    stopWhen: [
      { name: 'gateRefusalStorm', shouldStop: () => intake.refusalTracker.tripped() !== undefined },
    ],
    afterToolCall: withMidRunReminders(
      buildExternalizeAfterToolCall(createContextStoreRepository(deps.db), {
        userId,
        sessionId: session.id,
        toolOutputAvailable: tools.some((tool) => tool.name === TOOL.tool_output),
        sanitizeInput: deps.sanitizeToolInput
          ? (value) => deps.sanitizeToolInput!(userId, value)
          : () => null,
      }),
      () => env.drainMidRunReminders({ sessionId: session.id, agentId: speakerAgentId }),
    ),
    takeSteering,
    takeFollowUp: toolset.requiresTurnControl
      ? buildRequiredConversationControlFollowUp(turnControlDone, () => {
          state.conversationControlRepairTurn ??= state.currentTurnIndex + 1
        })
      : undefined,
    toolExecutionContext,
  })

  // Presentation is indexed from the FULL dispatch registry: indexing only the initially
  // visible tools made a deferred interactive tool revealed later through `activate_tools`
  // lose `standalone` and collapse into an ordinary tool line.
  const presentationByName = indexToolPresentation(dispatchTools)
  // The vault shield is wired at construction rather than at each writer: `message_end` reaches
  // `streamTool` with the RAW `toolCall.arguments` before any `tool_execution_start` exists, so
  // the first persisted copy of a command is written here. See `ItemAccumulatorOptions.sanitize`.
  const acc = createItemAccumulator(
    (name) => presentationByName.get(name)?.activeVerb ?? 'Running',
    {
      standaloneFor: (name) => presentationByName.get(name)?.standalone === true,
      presentationFor: (name) => presentationByName.get(name)?.presentation,
      actionsFor: (toolCallId) =>
        describeToolActions(toolCallId, asyncRegistry.getActions(toolCallId)),
      sanitize: env.deps.sanitizeToolInput
        ? (value) => env.deps.sanitizeToolInput!(userId, value)
        : undefined,
    },
  )

  const eventCtx: TurnEventContext = {
    env,
    userId,
    session,
    agentId: speakerAgentId,
    hitlTargetSessionId: frame.hitl.targetSessionId,
    assistantMessageId,
    state,
    acc,
    pluginHooksForRun: frame.teardown.pluginHooks,
    hookRunOptions: inputs.hookRunOptions,
    ccHooks: inputs.ccHooks,
    connection,
    providerId,
    modelCost: turn.modelCost,
    cacheDiagnostics: prompt.cacheDiagnostics,
    contextAnchorIdentity: history.contextIdentity,
    liveItemResolvers: runtimeState.liveItemResolvers,
    runLiveResolverKeys: frame.teardown.liveResolverKeys,
    mutatingToolNames: toolset.mutatingToolNames,
    observeMeasuredContext,
  }
  backgroundAccumulator = acc
  frame.steerCtxRef.current = eventCtx

  // Only the run's terminal state is journaled; the events themselves stream to the client.
  try {
    for await (const event of stream) {
      await handleAgentEvent(eventCtx, event)
      if (event.type === 'turn_end' && state.completedTurnIndex === event.turnIndex) {
        toolCheckpoint.notify(event.turnIndex)
      }
    }
    const runtimeResult = await stream.result
    await history.runRecord.finish(runtimeResult)
    requireCompletedRuntime(runtimeResult)
    if (toolset.requiresTurnControl && !turnControlDone()) {
      throw new Error('Multi-agent turn ended without the required conversation_control call')
    }
  } catch (error) {
    await history.runRecord.fail(error)
    throw error
  }
  return { eventCtx, acc }
}
