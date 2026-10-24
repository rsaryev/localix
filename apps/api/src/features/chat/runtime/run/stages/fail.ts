/**
 * Stage 9b — fail: any throw from the stages, turned into the run's outcome.
 *
 * A failure is not necessarily the end of the turn. A request that did not fit is re-entered
 * once through a context checkpoint; a stream that opened and then died (Overloaded, a socket drop, a premature end) retries,
 * because the SDK's own retries cover only pre-stream HTTP and without this the turn failed
 * while its error copy claimed "Retrying…". Only a failure neither retry takes is finalized,
 * with context diagnostics that say whether it happened at the provider or before it.
 *
 * The run row is closed FIRST: this path also catches preflight and history failures that
 * happen after the row opened but before a stream existed (including a synchronous throw out
 * of `agentRuntime.run`), and `fail` is idempotent with the stream stage's own close.
 */
import { presentErrorInfo } from '@localixai/agent/agents'

import { LocalContextBudgetExceededError } from '../../context-budget'
import { BUDGET_DECISION_TOKEN_KIND, contextWindowDiagnostics } from '../../context-diagnostics'
import { continuedRun, failedRun, type RunExecutionOutcome } from '../../run-outcome'
import { attemptOverflowRecovery, attemptTransientRetry } from '../recovery'
import { classifyRunError } from '../classify-run-error'
import { finalizeFailedRun } from '../finalize'
import { sendChildRunReport } from '../child-run-report'
import { fireStopFailure } from '../stop-failure'
import { currentAssistantMessageId, type RunFrame } from './frame'

export async function failRun(frame: RunFrame, error: unknown): Promise<RunExecutionOutcome> {
  const { env, params, userId, session, abort } = frame
  await frame.runRecord?.fail(error)
  // Read at each attempt: the row and the checkpoint are whatever the stream left CURRENT.
  const retryArgs = () => ({
    env,
    runtimeState: env.state,
    userId,
    session,
    assistantMessageId: currentAssistantMessageId(frame),
    params,
    abort,
    completedTurnCheckpoint: frame.steerCtxRef.current?.state.completedTurnCheckpoint,
    checkpointState: frame.steerCtxRef.current?.state,
    error,
  })
  const recovered = await attemptOverflowRecovery(retryArgs())
  if (recovered) return continuedRun()
  const transientRetried = await attemptTransientRetry(retryArgs())
  if (transientRetried) return continuedRun()

  const failure = classifyRunError(env.deps, userId, error)
  await finalizeFailedRun({
    env,
    userId,
    session,
    // Current, not admitted: model resolution may have rebound the provider (stages/turn.ts).
    route: frame.speakerRoute,
    assistantMessageId: currentAssistantMessageId(frame),
    error,
    contextDiagnostics: failureDiagnostics(frame, error),
    publishRuntimeSession: frame.publishRuntimeSession,
  })
  // The run's LOGICAL end: both retries declined above, so this failure is final.
  const outcome = env.state.stoppedRuntimeSessionIds.has(session.id) ? 'stopped' : 'failed'
  // The mods heard the turn start; they hear it end, stopped or dead on an error.
  await frame.teardown.mods
    ?.turnFailed({
      reason: outcome === 'stopped' ? 'aborted' : 'error',
    })
    .catch(() => {})
  // CC StopFailure, in place of Stop: the hooks built for this run, if it got that far.
  fireStopFailure(frame.teardown.ccHooks, failure, error, outcome === 'stopped')
  // A delegated child reports every run to its parent — a failed or stopped one included.
  sendChildRunReport(env, { userId, session, runId: currentAssistantMessageId(frame), outcome })
  env.deps.notifications?.runs.ended({
    userId,
    session,
    runId: currentAssistantMessageId(frame),
    outcome,
    // The same presentation the transcript notice was written from (`finalize.ts`).
    presented: presentErrorInfo(failure, { connectionId: frame.speakerRoute.providerConnectionId }),
    invocation: params.scope.executionContext.invocation.kind,
    connectionId: frame.speakerRoute.providerConnectionId,
    cascaded: env.state.cascadeStoppedSessionIds.has(session.id),
    failure: {
      rateLimited: failure.rateLimited,
      retryable: failure.retryable,
      authFailed: failure.authFailed,
    },
  })
  return failedRun(failure)
}

/** A local budget refusal carries its own frame and the token count the decision used. */
function failureDiagnostics(frame: RunFrame, error: unknown) {
  const localBudgetError = error instanceof LocalContextBudgetExceededError ? error : undefined
  const failureFrame = localBudgetError?.frame ?? frame.budget.frame
  if (!failureFrame) return undefined
  return {
    window: contextWindowDiagnostics(
      frame.session.id,
      failureFrame,
      localBudgetError
        ? { tokens: localBudgetError.requiredTokens, kind: BUDGET_DECISION_TOKEN_KIND }
        : undefined,
    ),
    attempt: {
      outcome: 'failed' as const,
      stage: frame.providerAttemptStarted ? ('provider' as const) : ('preflight' as const),
      ...(localBudgetError ? { contextTokens: localBudgetError.requiredTokens } : {}),
      tokenKind: localBudgetError ? BUDGET_DECISION_TOKEN_KIND : ('unknown' as const),
    },
  }
}
