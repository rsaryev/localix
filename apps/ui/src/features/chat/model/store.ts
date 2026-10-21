import { create } from 'zustand'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { makeOptimisticPair } from './optimisticPair'

import type { applyStreamEventToSession } from '@/shared/api/client'
import { backendClient, createWorkspaceSnapshot, type WorkspaceSnapshot } from '@/shared/api/client'
import type { ProviderConnection, UiSession, Project, MessageBinding } from '@/shared/api/contracts'
import { sessionRoute } from '@/shared/api/contracts'
import { sessionRosterEventPatch } from './sessionRosterEvents'
import { uiSessionSummary } from '@/shared/api/session-summary'
import { noticePosition } from '@/shared/api/applyStreamEvent/notices'

import type { Message } from './types'
import type { ReasoningEffort } from './reasoning'
import type { PartyRouteChoice } from './sessionPartyRoute'
import { mergeSessionBody } from './mergeSessionBody'
import { findSessionInState } from './findSession'
import { reconcileSessionListAfterReconnect } from './reconnect-session-list'
import { loadLastWorkspace } from './persistence'
import { rememberShellSessions } from '@/shared/lib/shellSnapshot'
import { registerWorkspaceRoots } from './workspaceRoots'
import {
  applyStreamEventPatch,
  clearLiveSessionBody,
  clearLiveSessionBodies,
  getLiveSessionBody,
  mergeSessionState,
  patchSessionById,
  sessionBelongsToScope,
  sortSessions,
} from './sessionListHelpers'
import {
  applySessionActivity,
  retainSessionActivity,
} from '@localixai/plugin-sdk/ui/session-activity'

// Single source lives in sessionActionsSlice (a session-lifecycle concern, used
// there on session open); re-exported here so consumers keep importing it from
// the store barrel.
export { logCurrentChatMessages } from './sessionActionsSlice'

import { createProjectActions } from './projectActionsSlice'
import { createSessionActions } from './sessionActionsSlice'
import type { ConversationStartStrategy } from './conversationStartStrategy'

/** Zustand setter passed into slice factories (the store's own `set`). */
export type CustomSet = (
  next: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>),
  replace?: boolean,
) => void

export interface OptimisticSendIds {
  userId: string
  assistantId: string
}

export interface ChatStore {
  _forgetSessions: (ids: readonly string[]) => void
  connections: ProviderConnection[]
  projects: Project[]
  /**
   * Whether {@link projects} is an ANSWER or still the empty initial value.
   *
   * An empty roster and an unloaded roster are the same array, and the launch-time
   * workspace restore has to tell them apart: it validates the remembered project against
   * this list, and reading "not there" off a list that simply hasn't arrived yet is what
   * used to drop every relaunch onto a fresh default-project chat. Projects hydrate on their own
   * request, LATER than `_hasHydrated` (which the pre-render shell frame flips), so no
   * other flag answers this.
   */
  projectsLoaded: boolean
  activeProjectId: string | null
  allSessions: UiSession[]
  sessions: UiSession[]
  activeSessionId: string | null
  _hasHydrated: boolean
  /** Bumps when the external O(1) live-body cache changes. */
  _liveSessionRevision: number
  isCreatingProject: boolean
  editingProject: Project | null
  /**
   * A message a cross-chat link asked to reveal once its transcript mounts. The target
   * transcript's MessageList consumes it (rings + scrolls) and clears it, so navigation never
   * has to guess how long the route change takes.
   */
  focusMessageId: string | null
  /** The session {@link focusMessageId} lives in; only that transcript may consume it. */
  focusMessageSessionId: string | null
  requestMessageFocus: (sessionId: string, messageId: string) => void
  clearMessageFocus: () => void
  hydrateWorkspace: (snapshot: WorkspaceSnapshot) => void
  loadWorkspace: (signal?: AbortSignal) => Promise<void>
  loadProjects: () => Promise<void>
  /** The single writer of a FETCHED projects roster — sets {@link projectsLoaded}. */
  _hydrateProjects: (projects: Project[]) => void
  /** URL→store scope reducer — called ONLY by the ChatPage URL sync. See ProjectActions. */
  selectProject: (id: string | null) => Promise<void>
  /** Home route: make the active session a default-project draft (reuse an existing
   *  matching one, else create). Returns it so the caller can stamp the URL. */
  createHomeDraft: () => Promise<UiSession | null>
  createProject: (name: string, workingDir: string) => Promise<Project>
  updateProject: (id: string, name: string, workingDir: string) => Promise<Project>
  deleteProject: (id: string) => Promise<void>
  setIsCreatingProject: (value: boolean) => void
  setEditingProject: (project: Project | null) => void

  selectSession: (id: string, options?: { signal?: AbortSignal }) => Promise<void>
  createSession: (title?: string, strategy?: ConversationStartStrategy) => Promise<UiSession | null>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  togglePinSession: (id: string) => Promise<void>
  toggleArchiveSession: (id: string) => Promise<void>
  moveSessionToProject: (id: string, projectId: string | null) => Promise<void>
  toggleUnreadSession: (id: string) => void
  /**
   * Choose the model for ONE participant of a conversation.
   *
   * `agentId` names whom the choice is for; omitted means the session's own participant, which
   * is unambiguous in a private chat and is the first member in a group. A model belongs to an
   * agent inside a conversation rather than to the conversation, because a group runs several
   * at once.
   */
  setModelSelection: (
    sessionId: string,
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => Promise<void>
  /** `agentId` names whose effort; omitted, the conversation's own participant. */
  setReasoningEffort: (s: string, e: ReasoningEffort, agentId?: string) => Promise<void>
  /** One model and level for every participant of a group, in one write. */
  applyPartyRoute: (
    sessionId: string,
    choice: PartyRouteChoice,
    agentIds?: readonly string[],
  ) => Promise<void>

  /** Stop a session's run (server owns cancellation; we clear its queue + optimistic flag). */
  stopGeneration: (sessionId: string) => void

  /** De-globalized run flag: patch one session's `isRunning` (optimistic lead before
   *  `run.started` lands, or after a local stop). Live events drive it per-session
   *  through applyStreamEventToSession; this only sets the optimistic edge. */
  _setSessionRunning: (sessionId: string, value: boolean) => void
  /**
   * Paint the send instantly: append your message plus (when no run is live yet)
   * an assistant skeleton row, both marked `optimistic`. The server echo replaces
   * them in place (see applyStreamEvent `message.created`), so Enter→visible is a
   * frame instead of a WebSocket round-trip plus the backend's persist chain.
   */
  _appendOptimisticSend: (
    sessionId: string,
    text: string,
    bindings?: MessageBinding[],
    /** Machine-composed (hidden) send — the painted user row carries isInternal. */
    internal?: boolean,
  ) => OptimisticSendIds
  /** Roll one send's placeholders back on failure. Omit ids only for an edit-resync
   *  that intentionally discards every unclaimed placeholder before reloading. */
  _dropOptimistic: (sessionId: string, ids?: Partial<OptimisticSendIds>) => void
  /**
   * Paint an edit-resend instantly: rewrite the edited user row under a fresh
   * optimistic id (stable renderKey, so the row never remounts), drop the
   * now-stale tail, and append an assistant skeleton as the stream target. The
   * server's branch echoes (message.removed + message.created) then claim and
   * settle these under the normal optimistic rules.
   */
  _beginOptimisticEdit: (sessionId: string, messageId: string, content: string) => void
  _applyStreamEvent: (
    sessionId: string,
    event: Parameters<typeof applyStreamEventToSession>[1],
  ) => void
  _replaceSession: (session: UiSession) => void
  /**
   * Append an inline system notice (key switch, model change, …) to a session's
   * timeline. `anchor` controls where it sits: 'last' (after the most recent
   * message) or 'lastUser' (after the latest user message — used for mid-run key
   * failover so the notice appears above the streaming assistant reply).
   */
  _addSystemNotice: (sessionId: string, message: Message, anchor?: 'last' | 'lastUser') => void
  /** Patch a single connection in place (avoids a full workspace refetch). */
}

export const useChatStore = create<ChatStore>()((set, get, api) => {
  // Per-scope in-flight session creation (projectId, or '__default__' while the default
  // project is server-resolved). A concurrent caller — a re-fired selectProject, the
  // home effect double-firing, or a fresh-chat send racing the URL sync's draft
  // minting — JOINS the pending creation instead of spawning a sibling chat.
  const autoCreateInFlight = new Map<string, Promise<UiSession | null>>()

  const customSet = (
    nextStateOrFn: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>),
    replace?: boolean,
  ) => {
    set((state) => {
      const next = typeof nextStateOrFn === 'function' ? nextStateOrFn(state) : nextStateOrFn
      return mergeSessionState(state, next)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, replace as any)
  }

  // Override the store api.setState so external setState also gets intercepted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.setState = customSet as any

  return {
    connections: [],
    projects: [],
    projectsLoaded: false,
    activeProjectId: null,
    allSessions: [],
    sessions: [],
    activeSessionId: null,
    _hasHydrated: false,
    _liveSessionRevision: 0,
    isCreatingProject: false,
    editingProject: null,
    focusMessageId: null,
    focusMessageSessionId: null,
    requestMessageFocus: (sessionId, messageId) =>
      set({ focusMessageId: messageId, focusMessageSessionId: sessionId }),
    clearMessageFocus: () => set({ focusMessageId: null, focusMessageSessionId: null }),
    hydrateWorkspace: (snapshot) => {
      // Token deltas live outside the roster arrays for O(1) streaming updates.
      // Snapshot them BEFORE clearing that side cache: a workspace revalidation
      // can race an active stream, and merging a summary over the stale roster
      // body would otherwise discard every delta since the last structural event.
      const currentSessions = get().allSessions
      const prevById = new Map(
        currentSessions.map((session) => [session.id, getLiveSessionBody(session.id) ?? session]),
      )
      clearLiveSessionBodies()
      // A refetch (e.g. mutate('workspace') after a key failover, or the edit
      // reload) is a whole-body replace per session — merge each body over the
      // stored copy so client-only notices, un-claimed optimistic rows, and the
      // live stream target survive (see mergeSessionBody).
      const snapshotSessions = snapshot.sessions.map((session) =>
        mergeSessionBody(prevById.get(session.id), session),
      )
      snapshot = { ...snapshot, sessions: snapshotSessions }

      const activeProjectId = get().activeProjectId
      const projectSessions = snapshot.sessions.filter((session) =>
        sessionBelongsToScope(session, activeProjectId),
      )
      const firstRootSession = projectSessions.find((s) => !s.parentSessionId)
      const nextActiveSessionId =
        snapshot.activeSessionId &&
        projectSessions.some((session) => session.id === snapshot.activeSessionId)
          ? snapshot.activeSessionId
          : (firstRootSession?.id ?? projectSessions[0]?.id ?? null)

      customSet({
        allSessions: snapshot.sessions,
        sessions: projectSessions,
        activeSessionId: nextActiveSessionId,
        _hasHydrated: true,
      })
      // The frame the next launch paints before the network answers. Recorded here — the
      // one place a confirmed roster lands — and as a ROSTER: these are the merged sessions,
      // bodies included, and a body in the frame was painted as loaded on the next launch and
      // never refetched. `uiSessionSummary` keeps only what a summary says.
      rememberShellSessions(activeProjectId, snapshot.sessions.map(uiSessionSummary))
    },

    loadWorkspace: async (signal) => {
      const before = get().allSessions
      // Session summaries are the only core readiness boundary. Connections and
      // projects hydrate independently in useWorkspace, and the active session
      // body is fetched lazily after this roster is painted. A slow optional
      // endpoint therefore cannot hold the entire workspace hostage.
      const fetched = await backendClient.listSessions(signal)
      const sessions = reconcileSessionListAfterReconnect(before, get().allSessions, fetched)

      // Same atomic launch-restore pair the pre-render shell frame paints from, so the
      // network answer lands in the scope the user is already looking at rather than
      // re-deriving it from a second key that could disagree.
      //
      // With no record — a first launch, or storage that answered nothing — the scope the
      // store already holds wins. Falling back to `null` instead would be claiming an
      // unresolved scope, and nothing belongs to one: the roster filtered to empty and the
      // active chat was dropped on every reload.
      const lastWorkspace = loadLastWorkspace()
      const activeProjectId = get()._hasHydrated
        ? get().activeProjectId
        : (lastWorkspace?.projectId ?? get().activeProjectId)

      const projectSessions = sessions.filter((session) =>
        sessionBelongsToScope(session, activeProjectId),
      )
      const firstRootSession = projectSessions.find((s) => !s.parentSessionId)
      const remembered = lastWorkspace?.sessionId ?? null
      const activeSessionId = get()._hasHydrated
        ? projectSessions.some((session) => session.id === get().activeSessionId)
          ? get().activeSessionId
          : null
        : remembered && projectSessions.some((session) => session.id === remembered)
          ? remembered
          : (firstRootSession?.id ?? projectSessions[0]?.id ?? null)

      customSet({ activeProjectId })
      get().hydrateWorkspace(createWorkspaceSnapshot(sessions, activeSessionId))
    },

    _hydrateProjects: (projects) => {
      customSet({ projects, projectsLoaded: true })
    },

    ...createProjectActions({ set, customSet, get }),

    ...createSessionActions({ customSet, get, autoCreateInFlight }),

    stopGeneration: (sessionId) => {
      if (!sessionId) return
      const wasRunning = findSessionInState(get(), sessionId)?.isRunning ?? false
      get()._setSessionRunning(sessionId, false)
      const optimisticStop = findSessionInState(get(), sessionId)
      // No "the person stopped it" marker here any more: the server records no finished-run row
      // for a stopped run (`notifications/producers/runs.ts`), so there is nothing to suppress.
      void backendClient.stop(sessionId).catch((error: unknown) => {
        // A Stop that never reached the server was silent: the button flipped back and the agent
        // kept working, with nothing saying why. The person pressed it, so they hear it failed.
        toast.error('Could not stop the agent', {
          description: errorMessage(error, '') || undefined,
          action: { label: 'Retry', onClick: () => get().stopGeneration(sessionId) },
        })
        // A transport failure says nothing about server state. Restore the
        // conservative running edge only if no stream event replaced our
        // optimistic stop in the meantime, then reconcile authoritatively.
        const state = get()
        if (wasRunning && findSessionInState(state, sessionId) === optimisticStop) {
          state._setSessionRunning(sessionId, true)
        }
        const beforeFetch = findSessionInState(get(), sessionId)
        void backendClient
          .getSession(sessionId)
          .then((session) => {
            const current = get()
            if (findSessionInState(current, sessionId) === beforeFetch) {
              current._replaceSession(session)
            }
          })
          .catch(() => {})
      })
    },

    _appendOptimisticSend: (sessionId, text, bindings, internal) => {
      const pair = makeOptimisticPair(text, bindings, internal)
      customSet((state) =>
        patchSessionById(state, sessionId, (session) => {
          // A live run already owns an assistant row (and will queue this
          // message), so only your own line is painted — a second skeleton
          // would read as a second reply in flight.
          const assistant: Message | null =
            session.isRunning || (session.queuedMessages?.length ?? 0) > 0 ? null : pair.assistant
          return {
            ...session,
            messages: assistant
              ? [...session.messages, pair.user, assistant]
              : [...session.messages, pair.user],
            // Drives the transcript's streaming visuals onto the skeleton row.
            streamingMessageId: assistant ? assistant.id : session.streamingMessageId,
          }
        }),
      )
      return { userId: pair.user.id, assistantId: pair.assistant.id }
    },

    _beginOptimisticEdit: (sessionId, messageId, content) => {
      const { user, assistant } = makeOptimisticPair(content)
      customSet((state) =>
        patchSessionById(state, sessionId, (session) => {
          const idx = session.messages.findIndex((m) => m.id === messageId)
          if (idx === -1) return session
          const original = session.messages[idx]
          // Rewrite under a FRESH optimistic id so the server's branch echoes
          // land as a normal claim: message.removed(old id) no-ops (the id is
          // gone) and message.created(branch user row) takes this slot. The
          // renderKey pins the row's React identity, so nothing remounts.
          const edited: Message = {
            ...original,
            id: user.id,
            renderKey: original.renderKey ?? original.id,
            content,
            optimistic: true,
          }
          return {
            ...session,
            messages: [...session.messages.slice(0, idx), edited, assistant],
            streamingMessageId: assistant.id,
          }
        }),
      )
    },

    _dropOptimistic: (sessionId, ids) => {
      const ownedIds = ids
        ? new Set(
            [ids.userId, ids.assistantId].filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          )
        : null
      const shouldDrop = (message: Message) =>
        Boolean(message.optimistic) && (!ownedIds || ownedIds.has(message.id))
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          session.messages.some(shouldDrop)
            ? {
                ...session,
                messages: session.messages.filter((message) => !shouldDrop(message)),
                streamingMessageId:
                  session.streamingMessageId &&
                  (!ownedIds
                    ? session.streamingMessageId.startsWith('optimistic-')
                    : ownedIds.has(session.streamingMessageId))
                    ? null
                    : session.streamingMessageId,
              }
            : session,
        ),
      )
    },

    _setSessionRunning: (sessionId, value) => {
      // Patch the optimistic flag in BOTH lists so a background-but-open tab keeps
      // its state even after selectSession evicts its body from `sessions`.
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          session.isRunning !== value ? { ...session, isRunning: value } : session,
        ),
      )
    },

    _applyStreamEvent: (sessionId, event) => {
      if (event.type === 'session.deleted') get()._forgetSessions(event.sessionIds)
      if (
        event.type === 'child_session.updated' ||
        event.type === 'session.updated' ||
        event.type === 'session.deleted'
      ) {
        // Pure session-list upsert. Resolving the parent's delegate tool item is
        // the BACKEND's job (markRuntimeSessionStatus → message.updated), so the
        // spinner clears through the normal item pipeline — no client-side join.
        customSet((state) => sessionRosterEventPatch(state, event) ?? {})
        // This is the ONE place rows enter and leave the sub-session roster, so it is where the
        // external tick store is reconciled against it. (A finished child keeps its last counts —
        // the delegate card's "N turns · M tools" summary — until its row is evicted; that used to
        // need an explicit carry-over here, because the summary snapshot would overwrite the
        // counters with `undefined`. Holding them outside the roster removes the hazard entirely.)
        retainSessionActivity(get().allSessions)
        return
      }

      if (event.type === 'child_session.activity') {
        // Deliberately NO store write. This is the hottest frame in the system and it carries no
        // roster state: writing it into `allSessions` minted a new array per tick and re-ran every
        // sidebar/breadcrumb/switcher/runtime-panel derivation over the whole roster. It lives in
        // an external per-id store that the ONE row showing it subscribes to.
        applySessionActivity(event.sessionId, {
          activity: event.activity,
          turnCount: event.turnCount,
          toolCount: event.toolCount,
        })
        return
      }

      customSet((state) => applyStreamEventPatch(state, sessionId, event))
    },

    _replaceSession: (nextSession) => {
      customSet((state) => {
        // Whole-body replace (reconcile watchdog, setting switches, error
        // recovery): merge over the stored copy so client-only notices, pending
        // optimistic rows and the live stream target aren't wiped mid-wait.
        const prev =
          getLiveSessionBody(nextSession.id) ??
          state.sessions.find((session) => session.id === nextSession.id) ??
          state.allSessions.find((session) => session.id === nextSession.id)
        const merged: UiSession = mergeSessionBody(prev, nextSession)
        clearLiveSessionBody(nextSession.id)
        return {
          sessions: sortSessions(
            state.sessions.some((session) => session.id === merged.id)
              ? state.sessions.map((session) => (session.id === merged.id ? merged : session))
              : [merged, ...state.sessions],
          ),
          activeSessionId: state.activeSessionId ?? merged.id,
        }
      })
    },

    _addSystemNotice: (sessionId, message, anchor = 'last') => {
      // Wherever the session lives: its only caller (`applySetting`) targets whatever
      // chat the surface is bound to, and a ChatSurface resolves its session through the
      // `allSessions` fallback (`useSessionById`) — so a sub-session or cross-project
      // chat silently swallowed the "Switched to X" notice while the setting DID change.
      customSet((state) =>
        patchSessionById(state, sessionId, (session) => {
          // Anchor the notice so it keeps its place in the timeline even after a
          // refetch reorders/replaces messages. 'lastUser' places a mid-run
          // failover notice above the (already-streaming) assistant reply.
          const reversed = [...session.messages].reverse()
          const anchorMsg =
            anchor === 'lastUser'
              ? reversed.find((m) => m.role === 'user')
              : reversed.find((m) => m.role !== 'system')
          const withinMessage = anchor === 'last' ? noticePosition(session, anchorMsg) : undefined
          const anchored: Message = {
            ...message,
            afterMessageId: anchorMsg?.id ?? null,
            withinMessage,
          }
          return { ...session, messages: [...session.messages, anchored] }
        }),
      )
    },
  }
})

export const selectActiveSession = (state: ChatStore): UiSession | null =>
  // Prefer the working list (carries message bodies); fall back to allSessions so
  // diving into a SUB-session (worker/reviewer/thread — only ever in allSessions
  // until selectSession finishes) resolves immediately instead of rendering a
  // blank workspace until a page reload.
  (state.activeSessionId ? getLiveSessionBody(state.activeSessionId) : undefined) ??
  state.sessions.find((session) => session.id === state.activeSessionId) ??
  state.allSessions.find((session) => session.id === state.activeSessionId) ??
  null

/** Resolve any session by id (working list → roster). Re-renders on its own stream
 *  tokens only — used by a ChatSurface bound to a specific session, not the active one. */
export const useSessionById = (sessionId: string | null) =>
  useChatStore((state) =>
    sessionId
      ? (getLiveSessionBody(sessionId) ??
        state.sessions.find((s) => s.id === sessionId) ??
        state.allSessions.find((s) => s.id === sessionId) ??
        null)
      : null,
  )

/**
 * WHO the open conversation is with — the agent id of its first participant, or `null`.
 *
 * A plain string selector rather than the session object: surfaces outside chat (Settings →
 * Capabilities opens on this agent's rules) want the identity and nothing else, and
 * subscribing to the whole session would re-render them on every streamed token.
 */
export const useActiveSessionAgentId = (): string | null =>
  useChatStore((state) => {
    const id = state.activeSessionId
    if (!id) return null
    const session =
      getLiveSessionBody(id) ??
      state.sessions.find((entry) => entry.id === id) ??
      state.allSessions.find((entry) => entry.id === id)
    return session ? (sessionRoute(session).agentId ?? null) : null
  })

export const useHasHydrated = () => useChatStore((state) => state._hasHydrated)

// The session tree lives here, so this is where a sub-session's workspace is answered (its root).
registerWorkspaceRoots(useChatStore)
