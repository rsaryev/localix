/**
 * Stage 8 — stream: call the model and fold its events into the assistant row.
 *
 * Everything the adapter needs mid-run is wired here and nowhere later, because once the
 * stream is open the only way back into the run is through these callbacks: steering (user
 * messages and mid-run reminders), the permission gate, the refusal-storm stop and output
 * externalization. A group turn needs no closing call: the host routes the finished reply
 * (`conversation-routing.ts`), so a turn costs one model request when it needs no tools.
 */
import { DEFAULT_TOKEN_CALIBRATION, observeTokenCalibration } from '@localixai/agent'
import { agentParticipant } from '../../../../../db/participant'

import { TOOL } from '../../../../agent-core/tool-names'
import { buildExternalizeAfterToolCall } from '../../../../context-store/externalize'
import { agentRoute } from '../../../../../contracts/session-route'
import { createForkLiveRun, createRecordedCalls } from '../../fork/fork-live'
import { runCacheKey } from '../../fork/fork-run'
import { speakerPlace } from '../../../policy/axes/seat'
import { createItemAccumulator } from '../../items'
import { withMidRunReminders } from '../../mid-run-reminders'
import { consoleWarnLogger } from '../../plugin-hook-logger'
import { createRunAsyncRegistry, describeToolActions } from '../async-registry'
import { ccAfterToolBatch, ccHookStopRule } from '../cc-tool-batch'
import { handleAgentEvent, type TurnEventContext } from '../event-handlers'
import { persistNow } from '../event-handlers-flush'
import { buildRuntimeToolContext } from '../runtime-execution'
import { wireRunSteering } from '../steering-wiring'
import { indexToolPresentation } from '../tool-assembly'
import { settleRunStream } from './stream-settle'
import type { RunInputs } from './context'
import { promptCacheRetentionFor } from '../speaker-agent'
import { currentAssistantMessageId, type RunFrame } from './frame'
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
  const { deps, state: runtimeState } = env
  const { state } = turn
  const { connection, credential, credentialStore, providerId, rawModelId } = turn.model
  const { dispatchTools, tools } = toolset

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
  const { takeSteering, deferral } = wireRunSteering(frame, turn)
  const speakerRoute = agentRoute(session, speakerAgentId)
  const toolExecutionContext = buildRuntimeToolContext({
    deps,
    userId,
    sessionId: session.id,
    ...(speakerRoute
      ? {
          speaker: {
            agentId: speakerRoute.agentId,
            handle: speakerRoute.handle,
            ...speakerPlace(turn.policy.seat),
          },
        }
      : {}),
    asyncRegistry,
    scratchDir: toolset.scratchDir,
    // A prompt reaches a person only when one can be shown AND the session expects one to answer
    // — an autonomous session is the second "no" (`policy/axes/human.ts`).
    interactive: turn.policy.human.canAnswer,
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
  // A fork of this run is made from the request it is sending now. A fork is itself sent under its
  // parent's session id, so its provider cache key is the parent's: the prefix is already there.
  const cache = runCacheKey(frame.fork, {
    sessionId: session.id,
    idleMs: turn.turnIdleMs,
    retention: promptCacheRetentionFor(inputs.pluginSubagent),
  })
  // The loop runs a tool without waiting for this host's handler to store the call that made it.
  const recordedCalls = createRecordedCalls()
  frame.forkLive = createForkLiveRun({
    recorded: (toolCallId) => recordedCalls.when(toolCallId, abort.signal),
    route: {
      providerConnectionId: connection.id,
      modelId: turn.model.effectiveModelId,
      ...(frame.speakerRoute.reasoningEffort
        ? { reasoningEffort: frame.speakerRoute.reasoningEffort }
        : {}),
    },
    currentRowId: () => currentAssistantMessageId(frame),
    currentPayload: () => state.currentPayload,
    systemPrompt: prompt.systemPrompt,
    tools,
    toolNames: toolset.runtimeTools.toolNames,
    profile: toolset.agentProfile,
    cacheSessionId: cache.sessionId,
    ...(cache.retention ? { retention: cache.retention } : {}),
  })
  // A synchronous adapter-startup throw needs no wrapper: it lands in the orchestrator's catch,
  // which closes the run row (`fail` is idempotent).
  const stream = deps.agentRuntime.run({
    sessionId: cache.sessionId,
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
    promptCacheIdleMs: cache.idleMs,
    // A plugin agent's `experimental.cacheTtl` (`1h` → the provider's long-lived cache), or the
    // parent's, for a fork.
    ...(cache.retention ? { promptCacheRetention: cache.retention } : {}),
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
      // A hook's `continue:false` ends the run even when a sibling call of the batch ran.
      ccHookStopRule(inputs.ccHooks),
    ],
    afterToolCall: withMidRunReminders(
      buildExternalizeAfterToolCall(deps.ports.contextStore, {
        userId,
        sessionId: session.id,
        participant: agentParticipant(speakerAgentId),
        toolOutputAvailable: tools.some((tool) => tool.name === TOOL.tool_output),
        sanitizeInput: deps.sanitizeToolInput
          ? (value) => deps.sanitizeToolInput!(userId, value)
          : () => null,
      }),
      () => env.drainMidRunReminders({ sessionId: session.id, agentId: speakerAgentId }),
    ),
    takeSteering,
    // CC PostToolBatch: context before the next request, or the run ends here.
    afterToolBatch: ccAfterToolBatch(inputs.ccHooks, (reason) =>
      deps.streamRegistry.publish(userId, session.id, {
        type: 'hook.notice',
        sessionId: session.id,
        message: reason,
        hookEvent: 'PostToolBatch',
      }),
    ),
    ...deferral,
    toolExecutionContext,
    // Claude Code mods' `turn.step` around each model request of the turn.
    modelStep: inputs.mods.modelStep(intake.turnFrame.activeInvocationId ?? assistantMessageId),
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
    miniAppHooksForRun: frame.teardown.miniAppHooks,
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
  await settleRunStream({
    stream,
    handle: async (event) => {
      try {
        await handleAgentEvent(eventCtx, event)
      } finally {
        if (event.type === 'tool_execution_start') recordedCalls.note(event.toolCallId)
      }
    },
    record: history.runRecord,
    storeReached: () => persistNow(eventCtx, state.payload),
    onStoreFailed: (error) =>
      consoleWarnLogger.warn(
        `[run] could not store what run ${assistantMessageId} reached before finalizing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  })
  return { eventCtx, acc }
}
