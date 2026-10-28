import * as loopOps from './loop-ops'
import * as monitorOps from './monitor-ops'
import type { StopResult } from '../contracts'
import type { ChatServiceGraph } from './service-graph'
import { createSessionCoordination } from './session-coordination'
import type { SessionCore } from './session-core'

/**
 * What the chat service exposes of the RUNTIME it owns: whether a session is busy, its queue,
 * its loops and monitors, stopping it, shutting the process down.
 *
 * These are the calls a scheduler, the desktop shell or a queue button makes about work that is
 * already in flight — none of them persists a message or starts a turn from content. Every
 * user-reachable one checks ownership through `requireSession` before it touches the runner,
 * because the runner itself keys by session id alone and would act on a foreign session.
 */
export interface ChatRuntimeFacadeDeps extends Pick<
  ChatServiceGraph,
  'repo' | 'runner' | 'withSessionMutationLock'
> {
  requireSession: SessionCore['requireSession']
}

export function createChatRuntimeFacade({
  repo,
  runner,
  withSessionMutationLock,
  requireSession,
}: ChatRuntimeFacadeDeps) {
  return {
    /**
     * What only the host can answer about a session — busy state, the idle-mutation lease, the
     * confirm overlay, who borrows whose directory. The seam a workspace-isolation provider is
     * built on; see `session-coordination.ts` for why each one has to live here.
     */
    sessionCoordination: createSessionCoordination({ repo, runner, withSessionMutationLock }),

    /** Whether a turn is currently running for this session (i.e. NOT idle/sleeping). */
    isRunning: (sessionId: string): boolean => runner.isRunning(sessionId),

    /** Running, OR a drain is about to start one — the gate a scheduled wake must use. */
    isBusy: (sessionId: string): boolean => runner.isBusy(sessionId),

    /** Each time a session's drain goes idle. */
    onSessionIdle: (...args: Parameters<typeof runner.onSessionIdle>) =>
      runner.onSessionIdle(...args),

    /**
     * Withdraw one delivery without touching the session's other work — a cancelled loop takes
     * back only the wake it has in flight, never the session's queued turns or sub-agents.
     */
    cancelWake: (...args: Parameters<typeof runner.cancelWake>) => runner.cancelWake(...args),

    /**
     * Epoch-ms a fire addressed to `agentId` (absent: the conversation chooses) would wait for an
     * exhausted provider route, or null. The loop action gates on it so a fire is held instead of
     * spent on a spent quota. Read through the resolved route, the same read a run admits on, so
     * the gate asks about the route the run would take; a session that is gone holds nothing.
     */
    async rateLimitedUntilMs(userId: string, sessionId: string): Promise<number | null> {
      const session = await repo.getSession(userId, sessionId).catch(() => null)
      return session ? runner.rateLimitedUntilMs(session) : null
    },

    /** Ids of every session with an active run right now (process-wide). The desktop
     *  shell uses this to warn before quitting while agents are still working. */
    runningSessionIds: (): string[] => runner.runningSessionIds(),

    /** Distinct (userId, sessionId) pairs owning at least one live background job. */
    listSessionsWithBackgroundJobs: () => runner.listSessionsWithBackgroundJobs(),

    /** Cancel an active session loop by id, withdrawing only the wake it has in flight. */
    cancelSessionLoop: loopOps.cancelSessionLoop,

    /** Fire a session loop immediately — an EXTRA occurrence off the cron slot. */
    runSessionLoop(userId: string, loopId: string): Promise<boolean> {
      return loopOps.runSessionLoop(userId, loopId)
    },

    /**
     * Stop one of the session's monitors — its work row's Stop button. Ends the watch
     * without touching the run in flight: the agent may well be working on what that monitor
     * just reported (see monitor-ops.ts).
     */
    stopSessionMonitor(userId: string, sessionId: string, monitorId: string): boolean {
      return monitorOps.stopSessionMonitor(userId, sessionId, monitorId)
    },

    /**
     * Remove a queued (not-yet-running) message from a session's backend queue —
     * the composer's "unqueue" button. Publishes `session_queue.updated`.
     */
    async removeQueuedMessage(
      userId: string,
      sessionId: string,
      itemId: string,
      options?: { wholeBatch?: boolean },
    ) {
      await requireSession(userId, sessionId)
      return runner.removeQueued(userId, sessionId, itemId, options)
    },

    /** Server-owned "send now": ownership check, interrupt, durable selection,
     * and delivery are one operation. No message payload round-trips through the
     * frontend and no successful step removes it before Stop settles. */
    async interruptAndPromoteQueuedMessage(userId: string, sessionId: string, itemId: string) {
      await requireSession(userId, sessionId)
      return runner.interruptAndPromoteQueued(userId, sessionId, itemId)
    },

    async clearQueuedMessages(userId: string, sessionId: string) {
      await requireSession(userId, sessionId)
      return runner.clearQueued(userId, sessionId)
    },

    async stop(sessionId: string, callerUserId?: string): Promise<boolean> {
      // Ownership gate: only the session's owner may abort its run. requireSession
      // filters by userId (throws when not owned). Omitted callerUserId = trusted
      // internal caller. No-op in single-user. Mirrors the interact ownership fix.
      if (callerUserId) {
        const owned = await requireSession(callerUserId, sessionId)
          .then(() => true)
          .catch(() => false)
        if (!owned) return false
      }
      return runner.stop(sessionId)
    },

    /** The person's Stop: the run ends and their queued messages come back instead of running. */
    async stopAndReturnQueued(sessionId: string, userId: string): Promise<StopResult> {
      const owned = await requireSession(userId, sessionId)
        .then(() => true)
        .catch(() => false)
      if (!owned) return { stopped: false, returned: [] }
      return runner.stopAndReturnQueued(userId, sessionId)
    },

    /** Process-wide teardown — abort in-flight runs and kill tracked child
     * processes (background jobs, sub-agents). Called from the server shutdown. */
    shutdown(): Promise<void> {
      return runner.shutdown()
    },
  }
}
