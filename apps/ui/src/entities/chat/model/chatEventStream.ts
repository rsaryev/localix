import { useCallback, useEffect, useMemo, useRef } from 'react'

import { toast } from '@/shared/lib/notify'
import { answerClock } from './answerClock'
import { backendClient, needsSessionResync } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import type { AgentStreamEvent } from '@/shared/api/contracts'
import { useChatStore } from './store'
import { findSessionInState } from './findSession'
import { routeAgentFileWrites } from './agentFileWrites'
import { reconcileAfterReconnect } from './reconnect-reconcile'
import { reconcileSessionListAfterReconnect } from './reconnect-session-list'
import { createWatchedSessionsReconciler } from './reconnect-watched'
import { patchSessionById } from './sessionListHelpers'
import { removeHitlInteractionsFromSource } from '@/shared/api/applyStreamEvent'
import { applyAttentionRoster, loadAttention } from './attention/store'
import { routePlanPresented } from './plans'
import {
  routeMiniAppCommand,
  routeFsChanged,
  routeTerminalOpened,
  routeTerminalState,
  routeTerminalFinished,
  routeMiniAppSessionEvent,
} from './sessionEventRouters'
import { sessionEventHandlersFor } from '@/shared/contrib/sessionEvents'
import { sessionPreviews } from '@/shared/lib/sessionPreviews'
import { resourceSync } from '@/shared/api/resourceSync'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { applyServerSession } from './sessionSync'

/**
 * DATA PLANE — mounted ONCE (in ChatPage). Owns the single realtime WebSocket
 * subscription that multiplexes every session's firehose, demuxes frames by their
 * tagged sessionId, and writes PER-SESSION store state (isRunning, pendingInteraction
 * via applyStreamEventToSession) plus the user-wide attention roster. No local React state
 * and no notion of "the active session" beyond focused-only toasts — so any number
 * of ChatSurfaces can read their own slice without a shared mirror.
 */
export function useChatEventStream(enabled = true): void {
  const reconcileInFlight = useRef<Set<string>>(new Set())
  const reconcileGeneration = useRef(new Map<string, number>())

  const reconcileSession = useCallback((sessionId: string) => {
    const generation = (reconcileGeneration.current.get(sessionId) ?? 0) + 1
    reconcileGeneration.current.set(sessionId, generation)
    if (reconcileInFlight.current.has(sessionId)) return
    reconcileInFlight.current.add(sessionId)
    void (async () => {
      let synced = true
      let cause: unknown
      while (useChatStore.getState().activeSessionId === sessionId) {
        const handling = reconcileGeneration.current.get(sessionId) ?? generation
        try {
          // oxlint-disable-next-line react-doctor/async-await-in-loop -- each pass incorporates frames that arrived during the previous reconciliation; parallel snapshots could overwrite newer state
          synced = await reconcileAfterReconnect({
            sessionId,
            getCurrent: () => findSessionInState(useChatStore.getState(), sessionId),
            isStillTarget: () => useChatStore.getState().activeSessionId === sessionId,
            fetchSession: () => backendClient.getSession(sessionId),
            applySession: (session) => {
              applyServerSession(session, { running: session.isRunning })
            },
          })
        } catch (error) {
          synced = false
          cause = error
        }
        if (reconcileGeneration.current.get(sessionId) === handling) break
      }
      if (!synced && useChatStore.getState().activeSessionId === sessionId) {
        const reason = cause === undefined ? '' : errorMessage(cause, '')
        toast.error('Could not resync this conversation', {
          description: `Reopen it to retry.${reason ? ` ${reason}` : ''}`,
        })
      }
    })().finally(() => {
      reconcileInFlight.current.delete(sessionId)
      reconcileGeneration.current.delete(sessionId)
    })
  }, [])
  const reconcileSessionRef = useRef(reconcileSession)
  const reconcileWatched = useMemo(
    () =>
      createWatchedSessionsReconciler({
        watchedIds: () => eventSocket.watchedSessionIds(),
        activeId: () => useChatStore.getState().activeSessionId,
        getSession: (id) => findSessionInState(useChatStore.getState(), id),
        fetchSession: (id) => backendClient.getSession(id),
        applySession: (session) => {
          applyServerSession(session, { running: session.isRunning })
        },
      }),
    [],
  )

  // Apply one demultiplexed firehose frame. `sessionId` is the publish (routing)
  // key the backend tagged the frame with. Everything lands in per-session store
  // state; the only active-session branch left is the focused retry toast.
  const handleSessionEvent = useCallback((sessionId: string, parsed: AgentStreamEvent) => {
    if (parsed.type === 'run.started') {
      answerClock.start(sessionId)
    } else if (parsed.type === 'run.completed' || parsed.type === 'run.failed') {
      answerClock.end(sessionId)
    }
    // Forward SAFE lifecycle signals (run start/completed/failed) to bridged
    // mini app views. Additive + non-consuming: the SDK allow-list gates what
    // crosses, and every other branch below still runs unchanged.
    routeMiniAppSessionEvent(sessionId, parsed.type)
    if (parsed.type === 'mini-app.command') {
      routeMiniAppCommand(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.updated') {
      sessionPreviews().updated(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.command') {
      sessionPreviews().command(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.closed') {
      sessionPreviews().closed(sessionId, parsed)
      return
    }
    if (parsed.type === 'fs.changed') {
      // Refreshes the file tree only: a file the agent wrote opens when the agent shows it.
      routeFsChanged(sessionId, parsed)
      return
    }
    if (parsed.type === 'terminal.opened') {
      routeTerminalOpened(parsed)
      return
    }
    if (parsed.type === 'terminal.state') {
      // A takeover or a served URL, the moment the server sees it — not on the registry poll.
      routeTerminalState(sessionId, parsed)
      return
    }
    if (parsed.type === 'terminal.finished') {
      routeTerminalFinished(sessionId, parsed)
      // Keep flowing into the generic reducer. It is currently inert there, but
      // doing so preserves the normal exhaustiveness path for future session UI.
    }
    if (parsed.type === 'plan.presented') {
      // A cue, not state: the versions themselves arrived as `plan.updated` just before it.
      routePlanPresented(parsed)
      return
    }
    if (parsed.type === 'attention.updated') {
      // User-wide, not session state: the whole roster of what waits on the person, last wins.
      applyAttentionRoster(parsed.items)
      return
    }

    // Mini-app-contributed session-event handlers (host.sessionEvents.register) —
    // AFTER the built-in routes so core keeps priority over its own types; a
    // contributed type is consumed here and never reaches the generic reducer.
    const contributed = sessionEventHandlersFor(parsed.type)
    if (contributed.length > 0) {
      for (const handle of contributed) handle(sessionId, parsed)
      return
    }

    const before = findSessionInState(useChatStore.getState(), sessionId)
    const resync = Boolean(before && needsSessionResync(before, parsed))
    useChatStore.getState()._applyStreamEvent(sessionId, parsed)
    // An agent file edit that just settled reaches every open editor of that file,
    // whatever the file watcher saw (`agentFileWrites.ts`). Read from the store: the frame's
    // items are wire-shaped, the reduced row is what the cards render from.
    if (parsed.type === 'message.updated' || parsed.type === 'message.created') {
      // The updated row is overwhelmingly the transcript tail — search from there.
      const row = findSessionInState(useChatStore.getState(), sessionId)?.messages.findLast(
        (message) => message.id === parsed.message.id,
      )
      if (row) routeAgentFileWrites(row.id, row.items)
    }
    // A thin/windowed client cannot derive an all-history usage delta for an
    // unloaded row. Inactive summaries hydrate authoritatively when opened.
    if (resync && useChatStore.getState().activeSessionId === sessionId)
      reconcileSessionRef.current(sessionId)

    const activeId = useChatStore.getState().activeSessionId

    // The Event Center rows for these frames (runs, requests, mentions, terminals, mini app
    // problems) are recorded by the SERVER journal where each fact happens, and arrive over the
    // socket as `n` frames (`shared/lib/notifications/inboxSync.ts`). What is waiting on the
    // person across conversations is the server's attention roster (`attention.updated`, above).
    // What stays here is the chat's own state: projected prompts and the unread dot.
    if (parsed.type === 'run.completed' || parsed.type === 'run.failed') {
      // A child can stop/fail while its request is projected onto the root chat.
      // Remove only prompts originating from that child; never settle the root run.
      const state = useChatStore.getState()
      const owner = [...state.sessions, ...state.allSessions].find((candidate) => {
        const interactions = [
          ...(candidate.pendingInteraction ? [candidate.pendingInteraction] : []),
          ...candidate.pendingInteractionQueue,
        ]
        return interactions.some((interaction) => interaction.sourceSessionId === sessionId)
      })
      if (owner) {
        useChatStore.setState((current) =>
          patchSessionById(current, owner.id, (candidate) =>
            removeHitlInteractionsFromSource(candidate, sessionId),
          ),
        )
      }
      if (sessionId !== activeId) {
        // Patch wherever the session lives: the sidebar's unread dot reads `allSessions` by id,
        // and writing only `sessions` left no dot on a chat that finished in ANOTHER project.
        useChatStore.setState((state) =>
          patchSessionById(state, sessionId, (s) => ({ ...s, isUnread: true })),
        )
      }
    }
  }, [])

  // Subscribe to the shared realtime WebSocket for the lifetime of the app. On
  // reconnect, reconcile the active session as a safety net for evicted frames.
  useEffect(() => {
    if (!enabled) return
    const offRoster = resourceSync.register('sessions', {
      read: async (signal) => {
        const before = useChatStore.getState().allSessions
        const sessions = await backendClient.listSessions(signal)
        return { before, sessions }
      },
      apply: ({ before, sessions }) =>
        useChatStore.setState((state) => ({
          allSessions: reconcileSessionListAfterReconnect(before, state.allSessions, sessions),
        })),
      onError: (error) => console.warn('[realtime] session roster sync failed', error),
    })
    const offEvent = eventSocket.onSessionEvent(handleSessionEvent)
    // The attention roster is read once now and again after every reconnect: its frame only
    // carries what changes while this window listens (`attention/store.ts`).
    void loadAttention()
    const offConnected = eventSocket.onConnected(() => void loadAttention())
    const offReconnect = eventSocket.onReconnect(() => {
      const activeId = useChatStore.getState().activeSessionId
      if (activeId) reconcileSession(activeId)
      // Background surfaces (grid tabs) lose live-only frames too — see `reconnect-watched.ts`.
      void reconcileWatched()
    })
    return () => {
      offRoster()
      offConnected()
      offEvent()
      offReconnect()
    }
  }, [enabled, handleSessionEvent, reconcileSession, reconcileWatched])
}
