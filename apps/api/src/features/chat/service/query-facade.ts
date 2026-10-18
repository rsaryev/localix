import type { createChatRepository } from '../repository'
import type { createAgentRunner } from '../runtime/agent-runner'
import type { HistorySearchHit, HistorySearchHitDetailed } from '../repository-types'
import type { SessionSummary } from '../contracts'
import * as sessionLifecycle from './session-lifecycle'
import { toFtsMatchQuery } from '../../agent-core/tools/history/history-search-format'
import * as loopOps from './loop-ops'

/**
 * The read-only questions asked of the session store — search, listings, projections.
 *
 * Grouped because they share one property that matters: none of them starts a run, mutates a
 * session, or touches the runtime beyond asking what is live. That is what makes them safe to
 * call from anywhere — a channel resolving a fallback model, the sidebar, the agent's own
 * `global_search` — and it is worth being able to see that at a glance rather than inferring it
 * from ninety neighbouring methods.
 */
export interface ChatQueryFacadeDeps {
  repo: ReturnType<typeof createChatRepository>
  runner: ReturnType<typeof createAgentRunner>
  sessionLifecycleCtx: sessionLifecycle.SessionLifecycleCtx
}

export function createChatQueryFacade({ repo, runner, sessionLifecycleCtx }: ChatQueryFacadeDeps) {
  return {
    /** Completion needs a visible tail, not full session hydration and runtime overlays. */
    async getInlineCompletionContext(userId: string, id: string) {
      const [session, digest] = await Promise.all([
        repo.getSession(userId, id),
        repo.getSessionDigestMessages(userId, id, 8),
      ])
      if (!session) return null
      return {
        id: session.id,
        projectId: session.projectId,
        rootSessionId: session.rootSessionId,
        messages: digest.recentPayloads.map((payload) => ({ payload })),
      }
    },
    /**
     * User-facing cross-conversation message search — reuses the same FTS5 index
     * the agent's `global_search` tool queries (no parallel search system). The
     * raw query is sanitized into an FTS5 MATCH; an empty/whitespace query or an
     * unavailable FTS5 index degrades to no results rather than throwing.
     */
    async searchHistory(userId: string, query: string, limit = 30): Promise<HistorySearchHit[]> {
      const match = toFtsMatchQuery(query)
      if (!match) return []
      try {
        return await repo.searchHistory(userId, match, limit)
      } catch {
        return []
      }
    },

    async searchHistoryDetailed(
      userId: string,
      query: string,
      limit = 30,
    ): Promise<HistorySearchHitDetailed[]> {
      const match = toFtsMatchQuery(query)
      if (!match) return []
      try {
        return await repo.searchHistoryDetailed(userId, match, limit)
      } catch {
        return []
      }
    },

    async listSessions(userId: string): Promise<{ sessions: SessionSummary[] }> {
      const result = await sessionLifecycle.listSessions(sessionLifecycleCtx, userId)
      // Overlay the RUNTIME states a summary row has no column for, so a page reload hydrates
      // the loop, work and queue strips from the list instead of each vanishing until its next
      // event.
      const overlays = await Promise.all(
        result.sessions.map(async (session) => ({
          session,
          loops: loopOps.listSessionLoops(userId, session.id),
          work: runner.listWork(userId, session.id),
          queued: await runner.listQueued(session.id),
        })),
      )
      for (const { session, loops, work, queued } of overlays) {
        if (loops.length > 0) session.loops = loops
        if (work.length > 0) session.work = work
        if (queued.length > 0) session.queuedMessages = queued
      }
      return result
    },

    /** Bounded channel-management projection: no message counts or runtime queue overlays. */
    listRecentChatSessions(userId: string, opts?: { projectId?: string | null; limit?: number }) {
      return repo.listRecentChatSessions(userId, opts)
    },

    /** Owner-scoped regular-chat point projection for channel actions. */
    getChatSessionProjection(userId: string, id: string) {
      return repo.getChatSessionProjection(userId, id)
    },
  }
}
