/**
 * Stage 9a — complete: a stream that ended without error, turned into the run's outcome.
 *
 * "Ended without error" is not yet "succeeded". A run that produced nothing at all is the
 * model silently returning empty (typically on an oversized wake-resume context), and
 * finishing it as a success would dead-end on the generic "Something went wrong" fallback, so
 * it is re-entered once through a context checkpoint instead. Only after that does the run
 * finalize.
 */
import { contextWindowDiagnostics, withTerminalContextDiagnostics } from '../../context-diagnostics'
import { prefixedWarnLogger } from '../../plugin-hook-logger'
import { completedRun, continuedRun, type RunExecutionOutcome } from '../../run-outcome'
import { attemptSilentEmptyRecovery, isSilentlyEmptyRun } from '../recovery'
import { finalizeSuccessfulRun } from '../finalize'
import { sendChildRunReport } from '../child-run-report'
import type { RunInputs } from './context'
import { currentAssistantMessageId, type RunFrame } from './frame'
import type { RunIntake } from './intake'
import type { ResolvedTurn } from './turn'
import type { RunStream } from './stream'

/**
 * Relative error above which a pre-call context estimate is worth reporting. A byte heuristic
 * never matches a real tokenizer exactly, so a small band is expected and silent; 15% is far
 * outside that band and large enough to change a checkpoint decision.
 */
const CONTEXT_ESTIMATE_DRIFT_REPORT_THRESHOLD = 0.15

export async function completeRun(
  frame: RunFrame,
  turn: ResolvedTurn,
  inputs: RunInputs,
  intake: RunIntake,
  streamed: RunStream,
): Promise<RunExecutionOutcome> {
  const { env, params, userId, session, abort } = frame
  const { state } = turn
  const { ccHooks } = inputs
  reportEstimateDrift(turn)

  if (
    isSilentlyEmptyRun({
      turns: state.timing.turns,
      hasContent: Boolean(state.currentPayload.content),
      isEmptyAcc: streamed.acc.isEmpty,
      stopReason: state.stopReason,
      aborted: abort.signal.aborted,
    })
  ) {
    const retried = await attemptSilentEmptyRecovery({
      env,
      runtimeState: env.state,
      userId,
      session,
      assistantMessageId: currentAssistantMessageId(frame),
      params,
      abort,
    })
    if (retried) return continuedRun()
  }

  const budgetFrame = frame.budget.frame
  if (budgetFrame) {
    const measuredTokens = state.lastTurnContextTokens
    const diagnostics = {
      window: contextWindowDiagnostics(
        session.id,
        budgetFrame,
        measuredTokens ? { tokens: measuredTokens, kind: 'measured' } : undefined,
      ),
      attempt: {
        outcome: 'succeeded' as const,
        stage: 'provider' as const,
        ...(measuredTokens ? { contextTokens: measuredTokens } : {}),
        tokenKind: measuredTokens ? ('measured' as const) : ('unknown' as const),
      },
    }
    state.payload = withTerminalContextDiagnostics(state.payload, diagnostics)
    state.currentPayload = state.payload
  }

  const continued = await finalizeSuccessfulRun({
    ctx: streamed.eventCtx,
    params,
    abort,
    providerEntry: turn.model.providerEntry,
    rawModelId: turn.model.rawModelId,
    loadedPlugins: inputs.loadedPlugins,
    loadedMiniApps: inputs.loadedMiniApps,
    ccHooks,
    mods: inputs.mods,
    promptMessage: intake.turnFrame.promptMessage,
    policy: turn.policy,
    publishRuntimeSession: frame.publishRuntimeSession,
  })
  if (continued) return continuedRun()
  // The run's LOGICAL end — no segment follows.
  const outcome = env.state.stoppedRuntimeSessionIds.has(session.id) ? 'stopped' : 'completed'
  // A delegated child reports every run to its parent, not only the one it was launched with.
  // One stopped at its turn limit reports partial output (CC `maxTurns`), not a failure.
  sendChildRunReport(env, {
    userId,
    session,
    runId: currentAssistantMessageId(frame),
    outcome,
    ...(state.stopReason === 'max_turns' ? { partial: true } : {}),
  })
  env.deps.notifications?.runs.ended({
    userId,
    session,
    runId: currentAssistantMessageId(frame),
    outcome,
    invocation: params.scope.executionContext.invocation.kind,
    hasQueuedTurns: () => env.hasPendingQueue(session.id),
    connectionId: frame.route.providerConnectionId,
    cascaded: env.state.cascadeStoppedSessionIds.has(session.id),
  })
  return completedRun()
}

/**
 * A drifting heuristic means the byte divisor is miscalibrated for real content; a drifting
 * provider anchor means the anchoring itself is wrong, the more serious of the two. Both are
 * reported past the noise floor, as metadata only — token counts and provenance, never text.
 */
function reportEstimateDrift(turn: ResolvedTurn): void {
  const drift = turn.state.contextEstimateDrift
  if (!drift || Math.abs(drift.ratio - 1) < CONTEXT_ESTIMATE_DRIFT_REPORT_THRESHOLD) return
  prefixedWarnLogger('context-estimate').warn(
    `${drift.source} estimate off by ${Math.round((drift.ratio - 1) * 100)}%`,
    {
      estimatedTokens: drift.estimatedTokens,
      measuredTokens: drift.measuredTokens,
      source: drift.source,
      modelId: turn.model.rawModelId,
    },
  )
}
