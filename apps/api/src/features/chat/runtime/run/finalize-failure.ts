/** Failure finalization: route cooldowns, failed-row persistence and system-owned notices. */
import {
  MAX_TRUSTED_RETRY_DELAY_MS,
  presentErrorInfo,
  type AgentErrorInfo,
} from '@localixai/agent/agents'
import type { StoredMessagePayload } from '../../../../db'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'
import { classifyRunError } from './classify-run-error'
import { announceRunFailure } from './finalize-notices'
import {
  withTerminalContextDiagnostics,
  type TerminalContextDiagnostics,
} from '../context-diagnostics'
import type { ProviderRoute } from '../route-cooldowns'

/**
 * Loop-backoff cooldown for a rate-limited provider route — how long a SCHEDULED loop stops firing
 * runs into an exhausted allowance. It gates scheduled fires only (the loop action's gate in
 * `loops/action.ts`, persisted as a trigger hold), never a
 * message the user sends, so a long cooldown costs nothing interactively.
 *
 * The floors below are what we invent when the provider said nothing. A provider that DID
 * state a window is honored up to `MAX_TRUSTED_RETRY_DELAY_MS`, the ceiling the classifier
 * already vetted the header against — deliberately NOT capped at our fallback floor, because capping
 * a server's own number is how a cooldown expires while the quota is still exhausted and the
 * next tick burns another run into the same 429. Capping an honored `retry-after` at a short
 * backoff ceiling turns a stated 60 s window into a guaranteed second 429.
 */
const RATE_LIMIT_BACKOFF_MIN_MS = 60_000 // 1m — invented floor for a transient 429
const QUOTA_CAP_BACKOFF_MS = 30 * 60_000 // 30m — a plan cap will not clear on a short wait

export function rateLimitBackoffMs(info: AgentErrorInfo): number {
  const floor = info.retryable ? RATE_LIMIT_BACKOFF_MIN_MS : QUOTA_CAP_BACKOFF_MS
  if (info.retryAfterMs === undefined) return floor
  return Math.min(MAX_TRUSTED_RETRY_DELAY_MS, Math.max(floor, info.retryAfterMs))
}

export async function finalizeFailedRun(args: {
  env: RunEnv
  userId: string
  session: SessionRecord
  /** The provider route the failed run took — what a rate-limit cooldown is keyed by. */
  route: ProviderRoute
  assistantMessageId: string
  error: unknown
  contextDiagnostics?: TerminalContextDiagnostics
  publishRuntimeSession: (status: SessionRecord['runtimeStatus']) => Promise<void>
}): Promise<void> {
  const { env, userId, session, assistantMessageId, error } = args
  // Redacted at the classification: `userMessage` reaches four sinks below and none of them
  // scrubs (see classify-run-error.ts).
  const info = classifyRunError(env.deps, userId, error)
  const { kind, userMessage } = info
  if (kind === 'fatal') {
    // The ERROR object, not `userMessage` — so it needs its own pass. `console.error` writes straight
    // to stdout without touching the pino redaction sink, and the raw object carries the provider's
    // whole response body plus its stack.
    console.error(
      '[agent-runner] fatal error in session',
      session.id,
      env.deps.sanitizeToolError?.(userId, error) ?? error,
    )
  }
  // A rate-limit / quota cap means the ROUTE has spent its allowance, not a bug. The cooldown
  // is recorded against the route this run took — not the session — so a conversation's other
  // agents on other routes keep firing (route-cooldowns.ts). A transient 429 holds this
  // model; a spent plan (non-retryable) holds the whole connection.
  if (info.rateLimited) {
    env.state.routeCooldowns.hold(
      args.route,
      info.retryable ? 'route' : 'connection',
      Date.now() + rateLimitBackoffMs(info),
    )
  }
  const assistantRecord = await env.repo.getMessage(userId, session.id, assistantMessageId)
  const stopped = env.state.stoppedRuntimeSessionIds.has(session.id)
  if (assistantRecord) {
    // THE REASON IS NOT THE MODEL'S TO SAY. When a run died before writing anything, the
    // provider's own message was dropped into the assistant row, so a raw upstream body —
    // `403: {"message":"Key limit exceeded (daily limit)…"}` — rendered as the agent's reply.
    // The row stays marked `failed`, because that is what a retry rewinds from; what it no
    // longer does is speak. The reason goes to the system line below, where the system speaks.
    let failedPayload: StoredMessagePayload = { ...assistantRecord.payload, failed: true }
    if (args.contextDiagnostics) {
      failedPayload = withTerminalContextDiagnostics(failedPayload, args.contextDiagnostics)
    }
    await env.persistAndPublish(
      userId,
      session.id,
      assistantMessageId,
      failedPayload,
      assistantRecord.createdAt,
    )
  } else if (!stopped) {
    console.warn(
      `[agent-runner] run in session ${session.id} (${session.sessionKind ?? 'chat'}) failed before producing any assistant output: ${userMessage}`,
    )
  }
  // WHAT HAPPENED, said by the system (`finalize-notices.ts`) — with or without an assistant
  // row. A run that failed at STARTUP (no model bound, a refused key on the first request) used
  // to say so only in the log and an ephemeral `run.failed` frame, so a person who looked away
  // came back to their own message and nothing under it. The notice is keyed by the run's
  // message id either way. Without the row it carries no Retry: `regenerate` rewinds FROM the
  // assistant row and answers 409 without one, so the button would fail the moment it was
  // pressed. Not for a STOPPED run: someone chose that, and a stopped worker must stay
  // output-less so reconcile's never-ran attempt-guard (a stopped run with no final text is
  // un-counted) holds.
  if (!stopped) {
    const presented = presentErrorInfo(info, { connectionId: args.route.providerConnectionId })
    await announceRunFailure(
      { env, userId, sessionId: session.id, assistantMessageId },
      assistantRecord
        ? presented
        : { ...presented, actions: presented.actions.filter((action) => action !== 'retry') },
    )
  }

  env.deps.streamRegistry.publish(userId, session.id, {
    type: 'run.failed',
    sessionId: session.id,
    messageId: assistantMessageId,
    error: userMessage,
    finishedAt: Date.now(),
  })
  await args.publishRuntimeSession(
    env.state.stoppedRuntimeSessionIds.has(session.id) ? 'stopped' : 'failed',
  )
}
