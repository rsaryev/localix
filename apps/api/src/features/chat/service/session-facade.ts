import type { z } from 'zod'
import type {
  importSessionRequestSchema,
  JoinRoutesView,
  MessageToolDetails,
  SessionDetail,
} from '../contracts'
import { importSession, type ImportSessionInput } from './import-session'
import type { ChatServiceGraph } from './service-graph'
import type { SessionCore } from './session-core'
import * as sessionDetail from './session-detail'
import * as sessionLifecycle from './session-lifecycle'
import { createDraftReuse } from './session-draft-reuse'
import type { StoredSystemNotice } from '../../../db/payload'
import { recordSessionNotice } from '../runtime/session-notice'

/**
 * A session's own lifecycle — create, import, read, patch, delete.
 *
 * Grouped because each of these acts on the session RECORD, not on a turn inside it: nothing
 * here persists a message or starts a run. Delete is the one with an ordering rule, and it is
 * spelled out at the call: the in-memory watches and loops of a session go only after its row
 * really is gone.
 */
export interface ChatSessionFacadeDeps extends Pick<
  ChatServiceGraph,
  'repo' | 'now' | 'routeDefaults'
> {
  sessionLifecycleCtx: SessionCore['sessionLifecycleCtx']
  sessionDetailCtx: SessionCore['sessionDetailCtx']
  getSessionDetail: SessionCore['getSessionDetail']
}

export function createChatSessionFacade({
  repo,
  now,
  routeDefaults,
  sessionLifecycleCtx,
  sessionDetailCtx,
  getSessionDetail,
}: ChatSessionFacadeDeps) {
  const landOnDraft = createDraftReuse(sessionLifecycleCtx)
  return {
    createSession(
      userId: string,
      input: sessionLifecycle.CreateSessionInput,
    ): Promise<SessionDetail> {
      if (input.reuseEmptyDraft) return landOnDraft(userId, input)
      return sessionLifecycle.createSession(sessionLifecycleCtx, userId, input)
    },

    /** Import an outside conversation as a real session — see import-session.ts. */
    async importSession(userId: string, input: z.infer<typeof importSessionRequestSchema>) {
      // The wire schema checks that each item is STORABLE (an id and a type) rather than mirroring
      // the whole `AgentItem` union, which would be a second definition drifting from the first.
      // The narrowing therefore happens once, here, at the boundary that did the validating.
      const session = await importSession(
        {
          createSession: (owner, created) =>
            sessionLifecycle.createSession(sessionLifecycleCtx, owner, created),
          repo,
          now: () => new Date(now()).toISOString(),
        },
        userId,
        input as ImportSessionInput,
      )
      sessionLifecycleCtx.publishSession(
        await sessionLifecycleCtx.requireSession(userId, session.id),
      )
      return getSessionDetail(userId, session.id)
    },

    async getSession(
      userId: string,
      id: string,
      opts?: { messageLimit?: number; deferToolDetails?: boolean },
    ): Promise<SessionDetail> {
      return getSessionDetail(userId, id, opts)
    },

    /** What an agent not invited yet would join on (`JoinRoutesView`). */
    async getJoinRoutes(userId: string, id: string): Promise<JoinRoutesView> {
      const session = await sessionLifecycleCtx.requireSession(userId, id)
      return routeDefaults.joinRoutes(userId, session.projectId ?? null)
    },

    getMessageToolDetails(
      userId: string,
      sessionId: string,
      messageId: string,
    ): Promise<MessageToolDetails> {
      return sessionDetail.getMessageToolDetails(sessionDetailCtx, userId, sessionId, messageId)
    },

    getSessionAgentRoute(userId: string, id: string) {
      return repo.getSessionAgentRoute(userId, id)
    },

    /**
     * A line about the conversation written by a feature outside chat (the plan's lifecycle),
     * through the ONE notice writer — so it is stored, published and model-facing exactly like
     * a membership or mode line, never a second shape of notice.
     */
    recordSessionNotice(userId: string, sessionId: string, notice: StoredSystemNotice) {
      return recordSessionNotice(sessionLifecycleCtx, userId, sessionId, notice)
    },

    /** The active branch's messages, notices included — what a feature reading the last turn needs. */
    listMessages(userId: string, sessionId: string) {
      return repo.listMessages(userId, sessionId)
    },

    /** A participant's handle in the conversation, or null when it is not (or no longer) in it. */
    async participantHandle(userId: string, sessionId: string, agentId: string) {
      const session = await sessionLifecycleCtx.requireSession(userId, sessionId)
      return session.agents.find((member) => member.agentId === agentId)?.handle ?? null
    },

    /** Every participant's handle in the conversation, in roster order. */
    async participantHandles(userId: string, sessionId: string) {
      const session = await sessionLifecycleCtx.requireSession(userId, sessionId)
      return session.agents.map((member) => member.handle)
    },

    updateSession(
      userId: string,
      id: string,
      patch: sessionLifecycle.UpdateSessionPatch,
    ): Promise<SessionDetail> {
      return sessionLifecycle.updateSession(sessionLifecycleCtx, userId, id, patch)
    },

    async deleteSession(userId: string, id: string): Promise<void> {
      // Its monitors and loops are reaped by the session-residue reactor once the deletion of
      // every id in the tree has committed (`session-residue.ts`).
      await sessionLifecycle.deleteSession(sessionLifecycleCtx, userId, id)
    },
  }
}
