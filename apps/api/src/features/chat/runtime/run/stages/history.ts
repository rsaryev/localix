/**
 * Stage 7 — history: open the durable run row, materialize the model-facing history, and make
 * the view it was built from durable before the request goes out.
 *
 * A preflight rejection (a local budget refusal, a history that cannot be built) is a real
 * run outcome, and it was invisible in `agent_runs` while the row opened only after history
 * materialized. So the row opens CONCURRENTLY with materialization, and a history failure is
 * held as a value until the insert settles — the failure path then always has a row to close.
 *
 * The turn's runtime context and any checkpoint it took are written BEFORE streaming: the next
 * turn rebuilds this exact view from them, and a crash mid-run must not leave a sent request the
 * log cannot reproduce.
 */
import type { ContextCheckpoint } from '@localixai/agent'

import { TOOL } from '../../../../agent-core/tool-names'
import { createModelContextRepository } from '../../../model-context-repository'
import { noteNextSessionStartSource } from '../../agent-runner-lifecycle'
import { participantAudienceFor } from '../../history/stages/participant-audience'
import type { ModelView } from '../../model-view/view'
import { prefixedWarnLogger } from '../../plugin-hook-logger'
import { buildHistoryRun } from '../history-run-factory'
import { startAgentRunRecord } from '../run-record'
import type { RunFrame } from './frame'
import type { RunIntake } from './intake'
import type { RunPrompt } from './prompt'
import type { RunToolset } from './tools'
import type { ResolvedTurn } from './turn'

export type RunHistory = Awaited<ReturnType<typeof materializeRunHistory>>

export async function materializeRunHistory(
  frame: RunFrame,
  turn: ResolvedTurn,
  toolset: RunToolset,
  prompt: RunPrompt,
  intake: RunIntake,
  view: ModelView,
  defaultCwd: string,
) {
  const { env, userId, session, speakerAgentId } = frame
  const { deps, state: runtimeState, now } = env
  const { providerId, rawModelId, credentialId } = turn.model

  const runRecordPromise = startAgentRunRecord({
    repository: env.agentRuns,
    runtime: deps.agentRuntime,
    userId,
    sessionId: session.id,
    agentId: speakerAgentId,
    providerId,
    modelId: rawModelId,
    credentialId,
    now,
    sanitize: env.deps.sanitizeToolInput
      ? (value) => env.deps.sanitizeToolInput!(userId, value)
      : undefined,
    logger: prefixedWarnLogger('agent-runner'),
  })

  const calibrationKey = `${providerId}/${rawModelId}`
  const historyRun = buildHistoryRun({
    deps,
    defaultCwd,
    recoveryToolAvailable: toolset.recoveryToolAvailable,
    acceptsImages: turn.modelInput?.includes('image') ?? false,
    ctx: {
      sessionId: session.id,
      frame: prompt.contextBudgetFrame,
      identity: {
        providerId,
        modelId: rawModelId,
        systemPromptHash: prompt.fixedContext.systemPromptHash,
        toolSchemaHash: prompt.fixedContext.toolSchemaHash,
      },
      // History is read from THIS participant's view, gated to the roster on the wire.
      participantAudience: participantAudienceFor(
        session,
        toolset.runtimeTools.toolNames,
        speakerAgentId,
      ),
      view,
      ...(frame.fork
        ? { fork: { toolCallId: frame.fork.toolCallId, first: frame.fork.first } }
        : {}),
      recallToolAvailable: toolset.runtimeTools.toolNames.includes(TOOL.global_search),
      memoryToolAvailable: toolset.runtimeTools.toolNames.includes(TOOL.memory),
      state: frame.stores.context,
      ...(runtimeState.tokenCalibration.has(calibrationKey)
        ? { calibration: runtimeState.tokenCalibration.get(calibrationKey) }
        : {}),
    },
  })
  const materializePromise = historyRun.materialize(intake.turnFrame, frame.abort.signal).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  const [runRecord, materialized] = await Promise.all([runRecordPromise, materializePromise])
  frame.runRecord = runRecord
  if (!materialized.ok) throw materialized.error

  const { wire, estimate, identity, turnContext, checkpoint } = materialized.value
  if (wire.length === 0) throw new Error('Agent runtime history has no trigger message')
  if (turnContext || checkpoint) {
    await createModelContextRepository(deps.db).write({
      sessionId: session.id,
      messageId: frame.assistantMessageId,
      ...(turnContext ? { turnContext } : {}),
      ...(checkpoint ? { checkpoint } : {}),
      now: now(),
    })
  }
  if (checkpoint) announceCheckpoint(frame, checkpoint, view.preCompactRan === true)

  // Final pre-token phase: the model is now being called (prefill/TTFT wait).
  frame.publishPhase('thinking')
  // Handed to the run state so the first measured turn can score it (`contextEstimateDrift`).
  // Read-only bookkeeping — no control flow depends on it.
  turn.state.initialContextEstimate = { tokens: estimate.tokens, source: estimate.source }

  return {
    runRecord,
    historyRun,
    calibrationKey,
    wire,
    estimate,
    contextIdentity: identity,
    checkpoint,
  }
}

/**
 * Tell whoever watches that the view moved. The transcript redraws its divider from
 * `session_model_view.updated`. And a checkpoint is this runtime's compaction, so Claude Code
 * hooks see it as one: `PostCompact` fires with `trigger: "auto"` (the epoch cards are
 * `compact_summary`), and the next run re-fires `SessionStart` with source `compact` so a hook
 * can re-inject what the rewritten view no longer carries.
 *
 * `PreCompact` normally ran before the checkpoint was decided, where a block skips it
 * (`stages/view.ts`). A checkpoint taken only because the history did not fit the request at all
 * was not asked first: it is announced to PreCompact here, where it can no longer block.
 */
export function announceCheckpoint(
  frame: RunFrame,
  checkpoint: ContextCheckpoint,
  preCompactRan = false,
): void {
  const { env, userId, session, speakerAgentId } = frame
  if (checkpoint.evictedThroughId) {
    env.deps.streamRegistry.publish(userId, session.id, {
      type: 'session_model_view.updated',
      sessionId: session.id,
      modelView: { agentId: speakerAgentId, evictedThroughId: checkpoint.evictedThroughId },
    })
  }
  const hooks = frame.teardown.ccHooks
  if (hooks?.active) {
    // PostCompact follows once PreCompact is done, with the cards as the compaction's summary.
    const summary = checkpoint.cards.map((card) => card.text).join('\n\n')
    void (preCompactRan ? Promise.resolve() : hooks.runPreCompact('auto'))
      .then(() => hooks.runPostCompact('auto', summary))
      .catch((error: unknown) => console.warn('[checkpoint] compaction hooks failed', error))
  }
  noteNextSessionStartSource(env.state, session.id, 'compact')
}
