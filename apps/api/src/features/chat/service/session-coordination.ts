import { sessionRoute } from '../../../contracts/session-route'
import type { AgentRunner } from '../runtime/agent-runner'
import type { ChatRepository } from '../repository'
import type { SessionMutationLock } from './session-access'

/**
 * What the host can answer about a session that NOTHING outside the host can.
 *
 * Moving a session's working directory while a turn is in flight corrupts it, and no amount of
 * polling from outside gets you a guarantee — only the thing that owns run state can say "it is
 * safe now" and hold it safe for the duration.
 *
 * So these are the host's, permanently. The words are deliberately generic: the host does not
 * know what a provider does with a directory, and this is the file where that ignorance has to be
 * real rather than aspirational.
 */
export interface SessionCoordination {
  /** Sessions with a turn in flight right now. */
  busySessionIds(): string[]
  /** Whether this one session has a turn in flight. */
  isSessionBusy(sessionId: string): boolean
  /**
   * Run `mutate` only while the session is idle, holding it idle throughout, and serialised
   * against every other mutation of the same session. `{ acquired: false }` means a turn was
   * running and nothing was attempted — the caller reports that, it is not an error.
   */
  withIdleSessionMutation<T>(
    sessionId: string,
    mutate: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }>
  /** The little a commit trailer needs about the run that produced it; null when unknown. */
  readSessionMetadata(userId: string, sessionId: string): Promise<{ model?: string | null } | null>
  /**
   * Whether the session has reached a TERMINAL runtime state — no turn is running and none will
   * resume in it. What a sweeper needs before reclaiming a directory the session was using.
   */
  isSessionTerminal(userId: string, sessionId: string): Promise<boolean>
}

export function createSessionCoordination(input: {
  repo: ChatRepository
  runner: AgentRunner
  withSessionMutationLock: SessionMutationLock
}): SessionCoordination {
  const { repo, runner, withSessionMutationLock } = input
  return {
    busySessionIds: () => runner.busySessionIds(),
    isSessionBusy: (sessionId) => runner.isBusy(sessionId),
    // BOTH locks, in this order. The mutation lock serialises concurrent movers of the same
    // session; the idle lease is what keeps a turn from starting underneath the one that wins.
    // Holding only the lease let two movers interleave; holding only the lock let a turn start.
    withIdleSessionMutation: (sessionId, mutate) =>
      withSessionMutationLock(sessionId, () => runner.withSessionIdleLease(sessionId, mutate)),
    readSessionMetadata: async (userId, sessionId) => {
      const session = await repo.getSession(userId, sessionId).catch(() => null)
      return session ? { model: sessionRoute(session).modelId } : null
    },
    // Unknown session → terminal. A sweeper asking about a row that is gone must be told it may
    // reclaim, not left waiting on a session that will never finish.
    isSessionTerminal: async (_userId, sessionId) => {
      const runtime = await repo.getSessionRuntime(sessionId)
      return runtime ? runtime.runtimeStatus !== 'running' : true
    },
  }
}
