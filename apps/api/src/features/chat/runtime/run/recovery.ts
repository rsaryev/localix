/**
 * Recovering a turn whose request could not be served, by re-entering it ONCE.
 *
 * Two failures are answered with a context checkpoint instead of an error: the provider (or the
 * local admission) rejecting the request as too long, and a model that returned NOTHING on an
 * oversized context (observed on wake-resume contexts: zero turns, no text, no
 * error). Neither is fixed by trying the same request again, and both used to be answered with an
 * LLM summary — a paid call, a wait, and a lossy handoff. A checkpoint is deterministic and free:
 * the re-entered run takes one (the lane's `checkpointDue`, consumed by the view stage) and the
 * chain's `checkpointRecovered` latch stops a checkpoint → overflow → checkpoint loop when even
 * the checkpointed view does not fit.
 *
 * A stream that died mid-response (Overloaded, a socket drop) is the third case and is simply
 * replayed: the SDK's own retries cover only pre-stream HTTP.
 *
 * Every attempt returns whether a run was scheduled; false lets the failure finalize normally.
 */
import type { CheckpointReason } from '@localixai/agent'

import { backoffMs } from '../../../../lib/backoff'
import type { SessionRecord } from '../../repository'
import type { RuntimeState } from '../agent-runner-state'
import { LocalContextBudgetExceededError } from '../context-budget'
import { sessionAgent } from '../message-envelope'
import { classifyRunError } from './classify-run-error'
import { reenterRun } from './reenter-run'
import {
  persistRetryCheckpoint,
  prepareRetryContinuation,
  type RetryCheckpoint,
} from './retry-checkpoint'
import { ensureSessionStores } from './session-stores'
import type { RunEnv, RunParams } from './types'

export interface RecoveryArgs extends RetryCheckpoint {
  env: RunEnv
  runtimeState: RuntimeState
  userId: string
  session: SessionRecord
  assistantMessageId: string
  params: RunParams
  abort: AbortController
}

export interface FailedRunRecoveryArgs extends RecoveryArgs {
  error: unknown
}

/**
 * A run that completed with ZERO turns, no assistant text, no tool items, no stop notice, and
 * was not aborted: the model returned nothing without throwing. Pure, so the guard is tested.
 */
export function isSilentlyEmptyRun(args: {
  turns: number
  hasContent: boolean
  isEmptyAcc: boolean
  stopReason: string | undefined
  aborted: boolean
}): boolean {
  return (
    args.turns === 0 && !args.hasContent && args.isEmptyAcc && !args.stopReason && !args.aborted
  )
}

/**
 * Is this failure a request that did not fit? A local refusal counts only when a checkpoint could
 * change it: an active turn or a protected first task that alone exceeds the budget does not
 * shrink by evicting older turns.
 */
export function isOversizedRequest(kind: string, error: unknown): boolean {
  if (error instanceof LocalContextBudgetExceededError) {
    return error.reason === 'estimated_context_too_large'
  }
  return kind === 'context_overflow'
}

export async function attemptOverflowRecovery({
  error,
  ...rest
}: FailedRunRecoveryArgs): Promise<boolean> {
  const info = classifyRunError(rest.env.deps, rest.userId, error)
  if (rest.params.chain.checkpointRecovered || !isOversizedRequest(info.kind, error)) return false
  return checkpointAndRerun(rest, 'overflow')
}

export async function attemptSilentEmptyRecovery(args: RecoveryArgs): Promise<boolean> {
  if (args.params.chain.checkpointRecovered) return false
  return checkpointAndRerun(args, 'empty_run')
}

async function checkpointAndRerun(args: RecoveryArgs, reason: CheckpointReason): Promise<boolean> {
  const { env, userId, session, assistantMessageId, params, abort } = args
  try {
    await persistRetryCheckpoint({
      env,
      userId,
      sessionId: session.id,
      assistantMessageId,
      completedTurnCheckpoint: args.completedTurnCheckpoint,
      checkpointState: args.checkpointState,
      signal: abort.signal,
    })
    const continuation = await prepareRetryContinuation({
      env,
      userId,
      sessionId: session.id,
      agent: sessionAgent(session, params.scope.speakerAgentId),
      assistantMessageId,
      completedTurnCheckpoint: args.completedTurnCheckpoint,
      signal: abort.signal,
    })
    if (abort.signal.aborted) return false
    ensureSessionStores(args.runtimeState, {
      sessionId: session.id,
      agentId: params.scope.speakerAgentId,
    }).context.checkpointDue = reason
    return reenterRun({
      env,
      params,
      abort,
      reason: `checkpoint:${reason}`,
      turn: {
        assistantMessageId: continuation.assistantMessageId,
        historyMessages: continuation.historyMessages,
      },
      chain: { checkpointRecovered: true },
    })
  } catch (recoveryError) {
    if (!abort.signal.aborted)
      console.warn(
        `[agent-runner] ${reason} recovery failed for session ${session.id}:`,
        recoveryError instanceof Error ? recoveryError.message : recoveryError,
      )
    return false
  }
}

/** Retry budget for transient mid-stream failures. Small on purpose: the SDK already
 *  retried the pre-stream HTTP layer; this only covers a stream that died mid-response. */
export const MAX_TRANSIENT_RETRIES = 2
/** Backoff floor/ceiling for the pre-retry wait, and the cap on honoring Retry-After. */
const TRANSIENT_RETRY = { baseMs: 2_000, maxMs: 15_000 }

/**
 * The wait before transient retry number `retryCount`: the provider's Retry-After when it stated
 * one, else the shared exponential backoff — either way clamped to [base, max], so a Retry-After of
 * 0 cannot hot-loop and a Retry-After of an hour cannot park the turn. PURE — exported for tests.
 */
export function transientRetryDelayMs(
  retryAfterMs: number | undefined,
  retryCount: number,
): number {
  const wanted = retryAfterMs ?? backoffMs(retryCount, TRANSIENT_RETRY)
  return Math.min(TRANSIENT_RETRY.maxMs, Math.max(wanted, TRANSIENT_RETRY.baseMs))
}

/**
 * Should this failed run be re-entered as a transient retry? PURE — exported for tests.
 *
 * Deliberately narrow:
 *  - `retryable` only — never rethrow-classes (auth, quota caps, plain fatals).
 *  - never when `rateLimited` — the loop-engine backoff owns that class; an eager
 *    retry would burn quota into the same limit.
 *  - never `context_overflow` — that recovery is a checkpoint, not a replay.
 *  - never after an abort — the user asked to stop.
 *  - capped at {@link MAX_TRANSIENT_RETRIES} per run chain via `chain.transientRetryCount`.
 */
export function shouldTransientRetry(
  info: { retryable: boolean; rateLimited?: boolean; kind: string },
  retryCount: number | undefined,
  aborted: boolean,
): boolean {
  return (
    info.retryable &&
    !info.rateLimited &&
    info.kind !== 'context_overflow' &&
    !aborted &&
    (retryCount ?? 0) < MAX_TRANSIENT_RETRIES
  )
}

/** Abort-aware sleep; resolves early (without throwing) when the signal fires. */
function backoffDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Re-enter the same turn after a transient mid-stream provider failure, honoring Retry-After
 * when the provider stated one (clamped). The settled prefix is kept; only the failed suffix
 * is excluded.
 */
export async function attemptTransientRetry({
  error,
  ...rest
}: FailedRunRecoveryArgs): Promise<boolean> {
  const info = classifyRunError(rest.env.deps, rest.userId, error)
  const retryCount = rest.params.chain.transientRetryCount
  if (!shouldTransientRetry(info, retryCount, rest.abort.signal.aborted)) return false

  const backoff = transientRetryDelayMs(info.retryAfterMs, retryCount)
  console.warn(
    `[agent-runner] transient provider failure in session ${rest.session.id} — retrying in ${backoff}ms (attempt ${retryCount + 1}/${MAX_TRANSIENT_RETRIES}): ${info.userMessage}`,
  )
  await backoffDelay(backoff, rest.abort.signal)
  if (rest.abort.signal.aborted) return false

  const { env, userId, session, assistantMessageId, params, abort } = rest
  try {
    const checkpoint = {
      env,
      userId,
      sessionId: session.id,
      agent: sessionAgent(session, params.scope.speakerAgentId),
      assistantMessageId,
      completedTurnCheckpoint: rest.completedTurnCheckpoint,
      checkpointState: rest.checkpointState,
      signal: abort.signal,
    }
    await persistRetryCheckpoint(checkpoint)
    const continuation = await prepareRetryContinuation(checkpoint)
    return reenterRun({
      env,
      params,
      abort,
      reason: 'transient',
      turn: continuation,
      chain: { transientRetryCount: retryCount + 1 },
    })
  } catch (recoveryError) {
    if (!abort.signal.aborted)
      console.warn('[agent-runner] transient recovery preparation failed:', recoveryError)
    return false
  }
}
