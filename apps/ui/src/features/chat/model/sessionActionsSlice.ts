import { backendClient } from '@/shared/api/client'
import { inspector } from '@/shared/lib/inspectorBus'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { closeNativePages } from '@/features/inspector/model/nativePages'
import type { UiSession } from '@/shared/api/contracts'
import type { Message } from './types'
import type { ReasoningEffort } from './reasoning'
import { systemNotices } from './systemNotices'
import {
  isEmptyDraftSession,
  patchSessionById,
  sessionBelongsToScope,
  sortSessions,
} from './sessionListHelpers'
import { findSessionInState } from './findSession'
import { mergeSessionBody } from './mergeSessionBody'
import { WarmSessionBodyCache } from './sessionBodyCache'
import { loadLastReasoning, rememberActiveSession, rememberLastReasoning } from './persistence'
import type { ChatStore, CustomSet } from './store'
import { agentRoute, sessionRoute, withRoute } from '@/shared/api/contracts'
import { isAgentUnavailable } from './newChatAgent'
import {
  activeConversationDraft,
  conversationCreationLatchKeys,
  resolveConversationStart,
  type ConversationStartStrategy,
} from './conversationStartStrategy'

export function logCurrentChatMessages(sessionId: string, messages: Message[]): void {
  // Dev-only and deliberately shallow: dumping the raw message array (full
  // content/reasoning/tool parts) makes DevTools retain every opened dialog's
  // messages forever and made switching to heavy sessions noticeably slow.
  if (!import.meta.env.DEV) return
  console.info(`[Localix chat] opened session ${sessionId}: ${messages.length} messages`)
}

function activateSessionBody(
  state: ChatStore,
  id: string,
  detail: UiSession,
  sessionBodyCache: WarmSessionBodyCache,
): Partial<ChatStore> {
  // Whole-body replace: merge over the stored copy so an open-during-send switch
  // (or SWR reconcile) doesn't wipe optimistic rows / live stream pointers.
  const prev = findSessionInState(state, id)
  const incoming = { ...mergeSessionBody(prev, detail), isUnread: false }
  return {
    activeSessionId: id,
    sessions: sortSessions(
      // A session created after the workspace snapshot may not be in the working
      // list yet. Insert it before replacement so the active id always resolves.
      (state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [...state.sessions, incoming]
      ).map((session) => {
        if (session.id === id) return incoming
        // Running sessions retain their bodies for background streaming. Idle
        // bodies move to the bounded LRU; preserve client-only notices in-store.
        if (session.messages.length > 0 && !session.isRunning) {
          if (session.messages.some((message) => message.role !== 'system')) {
            sessionBodyCache.put(session)
          }
          const notices = session.messages.filter((message) => message.role === 'system')
          return notices.length === session.messages.length
            ? session
            : {
                ...session,
                messages: notices,
                // The full body now lives only in the warm cache. Mark this
                // shell unloaded so it cannot flash the genuine empty greeting
                // before the route effect restores the cached transcript.
                bodyLoaded: false,
              }
        }
        return session
      }),
    ),
  }
}

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
  selectSession: (id: string, options?: { signal?: AbortSignal }) => Promise<void>
  createSession: (title?: string, strategy?: ConversationStartStrategy) => Promise<UiSession | null>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  togglePinSession: (id: string) => Promise<void>
  toggleArchiveSession: (id: string) => Promise<void>
  /** Reassign a chat to a project (or `null` for the project-less home scope). */
  moveSessionToProject: (id: string, projectId: string | null) => Promise<void>
  toggleUnreadSession: (id: string) => void
  /** See `ChatStore.setModelSelection` — `handle` names the participant the choice is for. */
  setModelSelection: (
    sessionId: string,
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => Promise<void>
  /** `agentId` names whose effort; omitted, it is the conversation's own participant. */
  setReasoningEffort: (
    sessionId: string,
    reasoningEffort: ReasoningEffort,
    agentId?: string,
  ) => Promise<void>
}

export function createSessionActions({
  customSet,
  get,
  autoCreateInFlight,
  sessionBodyCache = new WarmSessionBodyCache(),
}: SessionActionsDeps): SessionActions {
  // One ordered persistence lane per chat. The picker remains optimistic, but
  // quick A→B selections reach the backend in that same order and a late A
  // response can never paint over B.
  const modelSelectionWriteTail = new Map<string, Promise<UiSession>>()
  // Uncached session details can resolve out of order. Only the newest selection
  // request may activate its body; stale results still warm the bounded cache.
  let selectionRequestVersion = 0

  const actions: SessionActions = {
    selectSession: async (id, options) => {
      if (options?.signal?.aborted) return
      const requestVersion = ++selectionRequestVersion
      const beforeFetch = findSessionInState(get(), id)
      // A running session's store body is authoritative and must never be replaced
      // by an older idle snapshot. Its live body is retained by activateSessionBody.
      const cached = beforeFetch?.isRunning ? undefined : sessionBodyCache.get(id)
      if (beforeFetch?.isRunning) sessionBodyCache.delete(id)

      if (cached) {
        rememberActiveSession(id, cached.projectId ?? null)
        customSet((state) => activateSessionBody(state, id, cached, sessionBodyCache))
        logCurrentChatMessages(id, cached.messages)
      }

      const detail = await backendClient.getSession(id, options?.signal)
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
      // called with `{ project: session.projectId }`, and the legacy `/chat/:id`
      // redirect resolves the project before navigating). We still remember this
      // session as the scope's last-active chat.
      const sessionProjectId = detail.projectId ?? null
      // A warm hit already performed the switch. Reconcile it only while it is
      // still selected; if navigation moved on during the RPC, retain the fresh
      // idle body for the next switch without stealing focus or its persisted
      // last-active pointer back.
      if (requestVersion === selectionRequestVersion && (!cached || get().activeSessionId === id)) {
        rememberActiveSession(id, sessionProjectId)
        customSet((state) => activateSessionBody(state, id, detail, sessionBodyCache))
      } else {
        sessionBodyCache.put(detail)
      }
      logCurrentChatMessages(id, detail.messages)
    },

    createSession: async (title, strategy = activeConversationDraft()) => {
      const lastReasoning = loadLastReasoning()
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
      // Reuse an existing empty draft in the target scope instead of creating a duplicate
      // "New Chat". `null` can occur only before the default-project roster resolves; it is
      // kept separate from real project ids until the server returns the canonical project.
      // Prefer the active session when it is already a matching draft.
      const scope = state.allSessions.filter((s) => (s.projectId ?? null) === targetProjectId)
      // A draft is only reusable for the agent it is WITH. Without this, asking for a chat
      // with one agent would hand back an empty chat with another — the caller's whole
      // intent, silently dropped, and only visible once the wrong one answers.
      const isReusable = (session: (typeof scope)[number]) =>
        isEmptyDraftSession(session) && sessionRoute(session).agentId === agentId
      const active = scope.find((session) => session.id === state.activeSessionId)
      const reusable = active && isReusable(active) ? active : scope.find(isReusable)

      if (reusable) {
        // Only the title can need writing: the draft's route is already whatever the chain
        // resolves for it, and re-stating a model here would turn a resolved default into an
        // explicit per-seat choice the user never made.
        const needsUpdate = title !== undefined && reusable.title !== title

        let session = reusable
        if (needsUpdate) {
          session = await backendClient.updateSession(reusable.id, { title })
          get()._replaceSession(session)
        }
        rememberActiveSession(session.id, session.projectId ?? targetProjectId)
        customSet({ activeSessionId: session.id })
        return session
      }

      // Register BEFORE the first await (the promise body suspends at the RPC),
      // so a same-tick concurrent caller reliably joins. The registered promise
      // includes the store commit — a joiner's reuse scan must see the draft.
      const creation = (async () => {
        const request = {
          title,
          // The reasoning level carries; the model and the connection do not. A level is a
          // preference the browser owns, an id is a row the server owns.
          ...(lastReasoning ? { reasoningEffort: lastReasoning } : {}),
          projectId: targetProjectId,
        }
        // An agent the server refuses (`agent_unavailable`: withdrawn, or not allowed in a
        // chat) must not cost the user their New chat. An INHERITED one is a guess, so it
        // retries without it; a caller that NAMED one meant it, and that failure is theirs.
        const session = agentId
          ? await backendClient
              .createSession({ ...request, agentIds: [agentId] })
              .catch((error: unknown) => {
                if (!plan.fallbackWhenAgentUnavailable || !isAgentUnavailable(error)) throw error
                return backendClient.createSession(request)
              })
          : await backendClient.createSession(request)
        rememberActiveSession(session.id, session.projectId ?? targetProjectId)
        customSet((current) => ({
          sessions: sortSessions([session, ...current.sessions]),
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
        const message = errorMessage(error, '')
        if (!message.includes('Session not found')) {
          throw error
        }
      }

      sessionBodyCache.delete(id)
      composerDrafts.forget(id)

      // The strip is dropped below, and its pages would outlive it: unmounting only hides them.
      const previews = usePreviewStore.getState()
      closeNativePages(
        (previews.previewTabsBySession[id] ?? []).map((entry) => entry.previewId),
        'Could not close the pages of the deleted chat',
      )
      previews.discardSessionPreview(id)

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
        rememberActiveSession(activeSessionId, state.activeProjectId)
        return {
          allSessions,
          sessions: visibleSessions,
          activeSessionId,
        }
      })

      // Close the deleted session's whole grid scope — its chat tab, its Browser and every other
      // tab of it (terminals are normal scoped tabs, so their PTYs are reaped when their owned
      // panes unmount). The Browser is one per chat now, so no shared one is left to settle.
      inspector.closeSession(id)
    },

    renameSession: async (id, title) => {
      const session = await backendClient.updateSession(id, { title })
      get()._replaceSession(session)
    },

    togglePinSession: async (id) => {
      // The sidebar can pin a chat that is not in
      // the active project's working list, and `current` decided the NEW value.
      const current = findSessionInState(get(), id)
      if (!current) return
      const session = await backendClient.updateSession(id, { isPinned: !current.isPinned })
      get()._replaceSession(session)
    },

    toggleArchiveSession: async (id) => {
      // An archived chat is filtered out of the project view, so look it up in the
      // full set (allSessions) — not the project-scoped `sessions` list.
      const current = get().allSessions.find((session) => session.id === id)
      if (!current) return
      const session = await backendClient.updateSession(id, { isArchived: !current.isArchived })
      get()._replaceSession(session)
    },

    moveSessionToProject: async (id, projectId) => {
      // Look the chat up in the full roster (allSessions) — it may sit in a
      // different project group than the one currently in view.
      const current = get().allSessions.find((session) => session.id === id)
      if (!current || (current.projectId ?? null) === projectId) return
      const session = await backendClient.updateSession(id, { projectId })
      get()._replaceSession(session)
    },

    toggleUnreadSession: (id) => {
      // Driven in bulk from the sidebar, whose rows come from `allSessions` — so the
      // checkbox could name a session this writer could not reach.
      customSet((state) =>
        patchSessionById(state, id, (session) => ({ ...session, isUnread: !session.isUnread })),
      )
    },

    setModelSelection: async (sessionId, connectionId, modelId, reasoningEffort, agentId) => {
      const previous = findSessionInState(get(), sessionId)
      // Whom the choice is for. Resolved once, here, so the optimistic paint, the rollback and
      // the request all name the same participant even if the party changes mid-flight.
      const target = agentId ?? (previous ? sessionRoute(previous).agentId : undefined)
      const previousRoute = previous && target ? agentRoute(previous, target) : undefined
      // Model selection is interaction state: paint it synchronously. Waiting for
      // the PATCH response left a newly-created cross-scope chat displaying its
      // previous/null connection, even though the backend had already persisted
      // the choice. Roll back only if this exact optimistic pair is still current.
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          withRoute(
            session,
            {
              providerConnectionId: connectionId,
              modelId,
              ...(reasoningEffort ? { reasoningEffort } : {}),
            },
            target,
          ),
        ),
      )

      const persist = () =>
        backendClient.updateSession(sessionId, {
          route: {
            ...(target ? { agentId: target } : {}),
            providerConnectionId: connectionId,
            modelId,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        })
      const previousWrite = modelSelectionWriteTail.get(sessionId)
      const write = previousWrite ? previousWrite.then(persist, persist) : persist()
      modelSelectionWriteTail.set(sessionId, write)

      let session: UiSession
      let latest = false
      try {
        session = await write
        latest = modelSelectionWriteTail.get(sessionId) === write
      } catch (error) {
        if (previousRoute && target && modelSelectionWriteTail.get(sessionId) === write) {
          customSet((state) =>
            patchSessionById(state, sessionId, (current) => {
              const now = agentRoute(current, target)
              if (!now || now.providerConnectionId !== connectionId || now.modelId !== modelId)
                return current
              return withRoute(
                current,
                {
                  providerConnectionId: previousRoute.providerConnectionId,
                  modelId: previousRoute.modelId,
                  ...(reasoningEffort && now.reasoningEffort === reasoningEffort
                    ? { reasoningEffort: previousRoute.reasoningEffort }
                    : {}),
                },
                target,
              )
            }),
          )
        }
        throw error
      } finally {
        if (modelSelectionWriteTail.get(sessionId) === write) {
          modelSelectionWriteTail.delete(sessionId)
        }
      }

      // A newer choice may change only effort on the same model/connection. Pair equality
      // cannot detect that, so only the last write is allowed to replace the session snapshot.
      if (!latest) return
      const current = findSessionInState(get(), sessionId)
      const currentRoute = current && target ? agentRoute(current, target) : undefined
      if (
        currentRoute &&
        target &&
        currentRoute.providerConnectionId === connectionId &&
        currentRoute.modelId === modelId
      ) {
        // A reasoning change can race the model PATCH. Keep that newer effort
        // instead of allowing this response to repaint an older snapshot.
        get()._replaceSession(
          currentRoute.reasoningEffort !== reasoningEffort && reasoningEffort !== undefined
            ? withRoute(session, { reasoningEffort: currentRoute.reasoningEffort }, target)
            : session,
        )
        // The choice is not copied into the browser. Writing it to the seat IS the record —
        // the server reads the freshest non-blank seat back as the `recent` level of the model
        // chain (`repository-recent-routes.ts`), so a second copy here could only disagree
        // with it, and would outlive the database that holds the original.
        if (reasoningEffort) {
          rememberLastReasoning(reasoningEffort)
        }
        // The model line is the server's too, for the same reason as the effort's: it names the
        // participant and the agents read it. The CONNECTION line stays here — which credentials
        // a model is reached through is an account fact the conversation cannot act on, so it is
        // shown to the person and to nobody else.
        if (previousRoute?.providerConnectionId !== connectionId) {
          get()._addSystemNotice(
            sessionId,
            systemNotices.connectionChange(
              get().connections.find((connection) => connection.id === connectionId)?.label ??
                'connection',
            ),
          )
        }
      }
    },

    setReasoningEffort: async (sessionId, reasoningEffort, forAgentId) => {
      // No notice is drawn here. The server writes the line — naming the participant, and as a
      // row the AGENTS read too (`session-notice.ts`); a second, client-only copy would print
      // the same event twice and disagree with it about who it was about.
      // Effort travels with the model, so it re-routes a participant rather than the session.
      // WHOSE effort is the caller's to say — the picker configures one named member, the
      // compact control beside the composer speaks for the conversation and so for its first one.
      const target = findSessionInState(get(), sessionId)
      const agentId = forAgentId ?? (target ? sessionRoute(target).agentId : undefined)
      const route = target && agentId ? agentRoute(target, agentId) : undefined
      if (!route?.providerConnectionId || !route.modelId) return
      // A separate reasoning PATCH could overtake a model pick and replace its optimistic
      // route with an older response. Use the same ordered lane and rollback for both controls.
      await actions.setModelSelection(
        sessionId,
        route.providerConnectionId,
        route.modelId,
        reasoningEffort,
        agentId,
      )
    },
  }
  return actions
}
