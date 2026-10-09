import { ApiError } from '../../../lib/errors'
import {
  assertMutableChatSession,
  assertSessionNotBusy,
  type SessionMutationLock,
} from './session-access'
import type { createChatRepository, SessionRecord } from '../repository'
import type { AgentRunner } from '../runtime/agent-runner'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { AgentNotifications } from '../../notifications/producers'
import type { SessionDetail } from '../contracts'

/** Shared 404 raised when a referenced message id is absent from the session. */
export const messageNotFound = () => new ApiError(404, 'message_not_found', 'Message not found')

/** Closure values the branching operations need from createChatService. */
export interface BranchingOpsContext {
  repo: ReturnType<typeof createChatRepository>
  runner: AgentRunner
  streamRegistry: SessionStreamRegistry
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  getSessionDetail: (userId: string, id: string) => Promise<SessionDetail>
  withSessionMutationLock: SessionMutationLock
  /** An accepted regenerate retires the Retry of the failure it re-runs. */
  notifications?: Pick<AgentNotifications, 'runs'>
}

/**
 * One concurrency boundary for every operation that changes the active message
 * branch. The busy check deliberately happens *after* acquiring the per-session
 * lock: a mutation queued behind regenerate/edit must observe the run that the
 * first mutation started, rather than racing it from a stale pre-lock snapshot.
 *
 * Keep callers from taking this lock themselves. The keyed serializer is not
 * re-entrant, so centralising ownership here also makes accidental self-deadlocks
 * visible in review.
 */
export const withBranchMutation = <T>(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  mutate: (session: SessionRecord) => Promise<T>,
): Promise<T> =>
  ctx.withSessionMutationLock(sessionId, async () => {
    const session = await ctx.requireSession(userId, sessionId)
    assertMutableChatSession(session)
    assertSessionNotBusy(ctx.runner, sessionId)
    return mutate(session)
  })
