import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { inspector } from '@/shared/lib/inspectorBus'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { sessionPreviews } from '@/shared/lib/sessionPreviews'
import type { UiSession } from '@/shared/api/contracts'
import type { ReasoningEffort } from './reasoning'
import { patchSessionById, sessionBelongsToScope, sortSessions } from './sessionListHelpers'
import { activateSessionBody, logCurrentChatMessages } from './sessionBodyActivation'
import { createModelSelectionActions } from './sessionModelSelectionActions'
import { findSessionInState } from './findSession'
import { WarmSessionBodyCache } from './sessionBodyCache'
import { forgetSessionLocation } from './persistence'
import type { ChatStore, CustomSet } from './store'
import { isAgentUnavailable } from './newChatAgent'
import { createNewChatDrafts } from './newChatDrafts'
import {
  activeConversationDraft,
  conversationCreationLatchKeys,
  resolveConversationStart,
  type ConversationStartStrategy,
} from './conversationStartStrategy'
import { applyServerSession } from './sessionSync'

export { logCurrentChatMessages } from './sessionBodyActivation'

export interface SessionActionsDeps {
  customSet: CustomSet
  get: () => ChatStore
  /** Shared per-scope in-flight creation latch (projectId / '__default__'): a
   *  concurrent createSession joins the pending creation and reuses its draft
   *  instead of racing it into a sibling chat. */
  autoCreateInFlight: Map<string, Promise<UiSession | null>>
  /** Idle full bodies kept outside Zustand so warm switches can paint before RPC. */
  sessionBodyCache?: WarmSessionBodyCache
}

/** The session lifecycle + per-session settings actions of the chat store. */
export interface SessionActions {
  /** Release window-owned state for sessions removed by any caller/window. */
  _forgetSessions: (ids: readonly string[]) => void
  selectSession: (id: string, options?: { signal?: AbortSignal }) => Promise<void>
  createSession: (title?: string, strategy?: ConversationStartStrategy) => Promise<UiSession | null>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  togglePinSession: (id: string) => Promise<void>
  toggleArchiveSession: (id: string) => Promise<void>
  /** Reassign a chat to a project (`null` resolves to the default project on the server). */
  moveSessionToProject: (id: string, projectId: string | null) => Promise<void>
  toggleUnreadSession: (id: string) => void
  /** See `ChatStore.setModelSelection`. */
  setModelSelection: (
    sessionId: string,
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
  ) => Promise<void>
  setReasoningEffort: (sessionId: string, reasoningEffort: ReasoningEffort) => Promise<void>
}

export function createSessionActions({
  customSet,
  get,
  autoCreateInFlight,
  sessionBodyCache = new WarmSessionBodyCache(),
}: SessionActionsDeps): SessionActions {
  // Uncached session details can resolve out of order. Only the newest selection
  // request may activate its body; stale results still warm the bounded cache.
  let selectionRequestVersion = 0
  const pendingSelections = new Set<{ id: string; removed: boolean }>()
  const drafts = createNewChatDrafts()

  const actions: SessionActions = {
    _forgetSessions: (ids) => {
      for (const pending of pendingSelections) if (ids.includes(pending.id)) pending.removed = true
      sessionPreviews().forget(ids)
      for (const id of ids) {
        drafts.forget(id)
        sessionBodyCache.delete(id)
        composerDrafts.forget(id)
        inspector.closeSession(id)
      }
    },
    selectSession: async (id, options) => {
      if (options?.signal?.aborted) return
      const requestVersion = ++selectionRequestVersion
      const beforeFetch = findSessionInState(get(), id)
      // A running session's store body is authoritative and must never be replaced
      // by an older idle snapshot. Its live body is retained by activateSessionBody.
      const cached = beforeFetch?.isRunning ? undefined : sessionBodyCache.get(id)
      if (beforeFetch?.isRunning) sessionBodyCache.delete(id)

      if (cached) {
        customSet((state) => activateSessionBody(state, id, cached, sessionBodyCache))
        logCurrentChatMessages(id, cached.messages)
      }

      const pending = { id, removed: false }
      pendingSelections.add(pending)
      const detail = await backendClient
        .getSession(id, options?.signal)
        .finally(() => pendingSelections.delete(pending))
      if (pending.removed) return
      if (beforeFetch && !findSessionInState(get(), id)) return
      // The URL moved while a response was crossing the transport boundary.
      // Abort normally rejects the fetch, but a response that already completed
      // can still reach this line. Keep it warm without letting the retired route
      // reclaim focus.
      if (options?.signal?.aborted) {
        sessionBodyCache.put(detail)
        return
      }
      // Scope (activeProjectId) is URL-driven and set ONLY by the URL→store sync
      // (selectProject). selectSession never writes it: the single-scope invariant
      // is upheld by always navigating to a session's OWN scope (goToSession is
      // called with `{ project: session.projectId }`). We still remember this
      // session as the scope's last-active chat.
      // A warm hit already performed the switch. Reconcile it only while it is
      // still selected; if navigation moved on during the RPC, retain the fresh
      // idle body for the next switch without stealing focus or its persisted
      // last-active pointer back.
      if (requestVersion === selectionRequestVersion && (!cached || get().activeSessionId === id)) {
        customSet((state) => activateSessionBody(state, id, detail, sessionBodyCache))
      } else {
        sessionBodyCache.put(detail)
      }
      logCurrentChatMessages(id, detail.messages)
    },

    createSession: async (title, strategy = activeConversationDraft()) => {
      // NO model and NO connection are stated. Both used to be read back from localStorage and
      // checked against the live connection list here — a check the group-creation path did not
      // have, which is how a connection id left over from a deleted database reached the server
      // and answered 500. The server's own chain gives a better answer than the browser could:
      // the project's default, the route this agent was last on, its card
      // (`agent-route-resolution.ts`). Saying nothing is what lets it answer.

      // The target project scope. Callers that know the scope pass it explicitly
      // (the neutral route → the default project; a project's "+" → that project), which
      // is authoritative: relying on `state.activeProjectId` here is racy because
      // the URL→store sync effect can clobber it mid-await, dropping a new
      // chat into the project the user was just viewing. Fall back to the active
      // project only when no caller intent was given.
      const planningState = get()
      const plan = resolveConversationStart(planningState, strategy)
      const targetProjectId = plan.projectId
      // JOIN a creation already in flight for this scope instead of racing it —
      // the fresh-chat send and the URL sync's draft minting used to each create
      // a session, with the user's first message landing in the never-shown
      // sibling. Once the pending create commits, the reuse scan below finds it.
      const latchKeys = conversationCreationLatchKeys(planningState, plan)
      const pending = latchKeys.map((key) => autoCreateInFlight.get(key)).find(Boolean)
      if (pending) await pending.catch(() => null)

      const state = get()
      // WHOM the new chat is with, when the caller did not say.
      //
      // "New chat" says nothing about an agent, and the server's answer for "nobody said" is
      // the default assistant — so pressing + while talking to @qa dropped you into a chat
      // with someone else, and the only way back was the agent menu. Continuing with the
      // same counterpart is the common case; changing it is the deliberate one.
      const agentId = plan.agentId
      // Reuse only this window's fresh untouched draft instead of creating a duplicate
      // "New Chat". `null` can occur only before the default-project roster resolves; it is
      // kept separate from real project ids until the server returns the canonical project.
      // Prefer the active session when it is already a matching draft.
      const reusable = drafts.find(state.allSessions, state.activeSessionId, plan)

      if (reusable) {
        // Only the title can need writing: the draft's route is already whatever the chain
        // resolves for it, and re-stating a model here would turn a resolved default into an
        // explicit per-seat choice the user never made.
        const needsUpdate = title !== undefined && reusable.title !== title

        let session = reusable
        if (needsUpdate) {
          session = await backendClient.updateSession(reusable.id, { title })
          applyServerSession(session)
        }
        customSet({ activeSessionId: session.id })
        return session
      }

      // Register BEFORE the first await (the promise body suspends at the RPC),
      // so a same-tick concurrent caller reliably joins. The registered promise
      // includes the store commit — a joiner's reuse scan must see the draft.
      const creation = (async () => {
        const request = {
          title,
          projectId: targetProjectId,
          ...(strategy.landing ? { reuseEmptyDraft: true } : {}),
        }
        // An agent the server refuses (`agent_unavailable`: withdrawn, or not allowed in a
        // chat) must not cost the user their New chat. An INHERITED one is a guess, so it
        // retries without it; a caller that NAMED one meant it, and that failure is theirs.
        const session = agentId
          ? await backendClient.createSession({ ...request, agentId }).catch((error: unknown) => {
              if (!plan.fallbackWhenAgentUnavailable || !isAgentUnavailable(error)) throw error
              return backendClient.createSession(request)
            })
          : await backendClient.createSession(request)
        drafts.remember(session, targetProjectId)
        customSet((current) => ({
          sessions: sortSessions([
            session,
            ...current.sessions.filter((row) => row.id !== session.id),
          ]),
          activeSessionId: session.id,
        }))
        return session
      })()
      for (const key of latchKeys) autoCreateInFlight.set(key, creation)
      try {
        return await creation
      } finally {
        for (const key of latchKeys) {
          if (autoCreateInFlight.get(key) === creation) autoCreateInFlight.delete(key)
        }
      }
    },

    deleteSession: async (id) => {
      try {
        await backendClient.deleteSession(id)
      } catch (error) {
        // Already gone is the outcome the user asked for; anything else is a real failure.
        if (!(error instanceof ApiError && error.code === 'session_not_found')) throw error
      }

      actions._forgetSessions([id])

      customSet((state) => {
        const allSessions = state.allSessions.filter((session) => session.id !== id)
        const visibleSessions = sortSessions(
          allSessions.filter((session) => sessionBelongsToScope(session, state.activeProjectId)),
        )
        // Deleting the ACTIVE session lands on the neutral "no session" state —
        // never auto-pick the first/another existing conversation (ChatPage then
        // navigates to the home landing). Deleting a background session leaves the
        // active one untouched.
        const activeSessionId = state.activeSessionId === id ? null : state.activeSessionId
        forgetSessionLocation(state.activeProjectId, id)
        return {
          allSessions,
          sessions: visibleSessions,
          activeSessionId,
        }
      })

      // Close the deleted session's whole grid scope — its chat tab, its Browser and every other
      // tab of it (terminals are normal scoped tabs, so their PTYs are reaped when their owned
      // panes unmount). The Browser is one per chat now, so no shared one is left to settle.
    },

    renameSession: async (id, title) => {
      // Every surface, this one included, learns the change from the `session.updated` frame.
      await backendClient.updateSession(id, { title })
    },

    togglePinSession: async (id) => {
      // The sidebar can pin a chat that is not in
      // the active project's working list, and `current` decided the NEW value.
      const current = findSessionInState(get(), id)
      if (!current) return
      await backendClient.updateSession(id, { isPinned: !current.isPinned })
    },

    toggleArchiveSession: async (id) => {
      // An archived chat is filtered out of the project view, so look it up in the
      // full set (allSessions) — not the project-scoped `sessions` list.
      const current = get().allSessions.find((session) => session.id === id)
      if (!current) return
      await backendClient.updateSession(id, { isArchived: !current.isArchived })
    },

    moveSessionToProject: async (id, projectId) => {
      // Look the chat up in the full roster (allSessions) — it may sit in a
      // different project group than the one currently in view.
      const current = get().allSessions.find((session) => session.id === id)
      if (!current || (current.projectId ?? null) === projectId) return
      await backendClient.updateSession(id, { projectId })
    },

    toggleUnreadSession: (id) => {
      // Driven in bulk from the sidebar, whose rows come from `allSessions` — so the
      // checkbox could name a session this writer could not reach.
      customSet((state) =>
        patchSessionById(state, id, (session) => ({ ...session, isUnread: !session.isUnread })),
      )
    },

    ...createModelSelectionActions({ customSet, get }),
  }
  return actions
}
