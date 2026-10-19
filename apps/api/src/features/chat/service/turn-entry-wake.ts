import { agentParticipant } from '../../../db/participant'
import { ApiError, errorMessage } from '../../../lib/errors'
import type { SessionRecord } from '../repository'
import type { WakeRequest } from '../contracts'
import type { RunExecutionOutcome } from '../runtime/run-outcome'
import type { TurnEntryContext } from './turn-entry-contracts'

/**
 * Why a wake did not land. `gone` and `not-chat` are ordinary outcomes; `unreadable`
 * is a repository failure and the only one worth telling an operator about.
 */
export type WakeMiss = 'gone' | 'not-chat' | 'unreadable'

/** The answer {@link wakeSession} owes its caller. `detail` carries the store's raw text. */
export interface WakeDelivery {
  delivered: boolean
  missed?: WakeMiss
  detail?: string
}

const DELIVERED: WakeDelivery = { delivered: true }

/**
 * Load the target of a wake, distinguishing "no such session" from "the store failed".
 *
 * Both wake entry points below are fire-and-forget at every call site (a plugin, the
 * sleep timer, a finished child's report), so neither can propagate: an
 * unhandled rejection there would take out an unrelated turn. But `catch(() => null)`
 * made a transient repository error indistinguishable from a deleted session, and the
 * consequence is not symmetric — a dropped report wake leaves the parent waiting with
 * nothing anywhere saying why. A 404 is the ordinary case and stays quiet; anything else is
 * named, AND reported back so the producer can log it against its own subject.
 */
async function loadWakeTarget(
  ctx: TurnEntryContext,
  userId: string,
  sessionId: string,
): Promise<{ session: SessionRecord } | { session?: undefined; miss: WakeMiss; detail?: string }> {
  try {
    return { session: await ctx.requireSession(userId, sessionId) }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { miss: 'gone' }
    console.error(`[wake] could not load session ${sessionId}; the wake was dropped`, err)
    return { miss: 'unreadable', detail: errorMessage(err) }
  }
}

/**
 * Push an internal message into a CHAT session and run it — how a producer that is not the
 * person (a loop, a finished child, a plugin) starts a turn. No-op if the session is gone or
 * isn't a chat session.
 *
 * It ANSWERS whether the wake landed. Every producer is fire-and-forget by design (a
 * wake must never fail the turn that caused it), which used to mean a repository error
 * dropped a wake into silence with nothing anywhere saying why. The producer knows what the wake was FOR, so it is the only place that can say
 * what was lost — this hands it the fact, and each call site logs it against its own
 * subject. Retrying is deliberately NOT done here: see the call sites.
 */
export async function wakeSession(
  ctx: TurnEntryContext,
  request: WakeRequest,
): Promise<WakeDelivery> {
  const target = await loadWakeTarget(ctx, request.userId, request.sessionId)
  if (!target.session) return { delivered: false, missed: target.miss, detail: target.detail }
  if (!acceptsWake(target.session, request)) return { delivered: false, missed: 'not-chat' }
  await ctx.runner.wake(wakeParams(target.session, request))
  return DELIVERED
}

/**
 * A chat takes any wake. A delegated child takes exactly one kind: the report of a child it
 * delegated itself — once children delegate in turn, that report answers the child that asked,
 * which integrates it and reports upward (`delegation-report.ts`). Nothing else wakes a child
 * session through here, and a closed one takes nothing at all.
 */
function acceptsWake(session: SessionRecord, request: WakeRequest): boolean {
  if (session.sessionKind === 'chat') return true
  return (
    request.source === 'subagent' &&
    session.sessionKind === 'subagent' &&
    session.provenance.kind === 'task-delegation' &&
    !session.closedAt
  )
}

/**
 * The queue's view of a request, against the session as it is NOW.
 *
 * An addressee who has left the conversation is dropped rather than kept: the drain dismisses a
 * delivery no current participant answers, so a loop armed by @qa, or a report owed to the
 * participant who delegated, would otherwise vanish once they were removed. Without `to` the
 * conversation's own strategy chooses who answers — the wake still lands.
 */
function wakeParams(session: SessionRecord, request: WakeRequest) {
  const {
    userId,
    content,
    source,
    to,
    addressedAs,
    deliveryKey,
    receipt,
    extraDisabledTools,
    coalesce,
    report,
  } = request
  const present =
    to !== undefined &&
    session.agents.some((member) => agentParticipant(member.agentId) === to.participant)
  return {
    userId,
    session,
    content,
    source,
    ...(extraDisabledTools ? { extraDisabledTools } : {}),
    ...(request.plugin ? { plugins: [request.plugin] } : {}),
    ...(coalesce ? { coalesce } : {}),
    ...(report ? { report } : {}),
    ...(deliveryKey ? { deliveryKey, ...(receipt ? { receipt } : {}) } : {}),
    ...(present ? { to } : to === undefined && addressedAs !== undefined ? { addressedAs } : {}),
  }
}

/**
 * Scheduler-facing wake that observes the run outcome instead of only durable
 * queue admission. Kept separate from ordinary fire-and-forget wake producers
 * so background completions never inherit scheduler backpressure semantics.
 */
export async function wakeSessionAndWait(
  ctx: TurnEntryContext,
  request: WakeRequest,
): Promise<RunExecutionOutcome> {
  // Repository failures must stay distinguishable from an unsupported session
  // kind: collapsing both to "unavailable/non-retryable" made a transient DB
  // outage permanently count as a scheduler failure.
  const session = await ctx.requireSession(request.userId, request.sessionId)
  if (session.sessionKind !== 'chat') {
    return {
      status: 'failed',
      kind: 'fatal',
      message: `Session ${request.sessionId} is unavailable for a scheduled wake.`,
      retryable: false,
      rateLimited: false,
    }
  }
  return ctx.runner.wakeAndWait(wakeParams(session, request))
}
