import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { MessageBinding } from '@localixai/api/client'
import { toast } from '@/shared/lib/notify'
import { sendChatMessage } from './sendChatMessage'
import { answerClock } from './answerClock'
import { ApiError, backendClient, needsSessionResync } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import type {
  AgentStreamEvent,
  PendingAskInteraction,
  PendingConfirmInteraction,
  PendingRequestSecretInteraction,
  UiPendingHitlInteraction as PendingHitlInteraction,
} from '@/shared/api/contracts'
import type { ReasoningEffort } from './reasoning'
import { useChatStore } from './store'
import { findSessionInState } from './findSession'
import { routeAgentFileWrites } from './agentFileWrites'
import { reconcileAfterReconnect } from './reconnect-reconcile'
import { reconcileSessionListAfterReconnect } from './reconnect-session-list'
import { createWatchedSessionsReconciler } from './reconnect-watched'
import { patchSessionById } from './sessionListHelpers'
import { removeHitlInteractionsFromSource } from '@/shared/api/applyStreamEvent'
import { recoverInactiveHitlSession } from './hitlInteraction'
import { applyAttentionRoster, loadAttention } from './attention/store'
import { routePlanPresented } from './plans'
import {
  routePluginCommand,
  routePreviewUpdated,
  routePreviewCommand,
  routePreviewClosed,
  routeFsChanged,
  routeFsDocumentsOpened,
  routeFollowAgentEdits,
  routeTerminalOpened,
  routeTerminalFinished,
  routePluginSessionEvent,
} from './sessionEventRouters'
import { routeTerminalState } from '@/features/terminal/model/terminalTabs'
import { sessionEventHandlersFor } from '@/shared/contrib/sessionEvents'
import { resourceSync } from '@/shared/api/resourceSync'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

export interface AgentOptions {
  model: string
  reasoningEffort: ReasoningEffort
}

// Pending-interaction types are owned by shared/api/contracts (the UI shape of
// the API HITL contract); re-exported here to keep existing call sites stable.
export type { PendingAskInteraction, PendingConfirmInteraction, PendingRequestSecretInteraction }
export type { PendingHitlInteraction }

/** Read one session's `isRunning` from the store (working list → roster). */
function sessionRunning(sessionId: string | null): boolean {
  if (!sessionId) return false
  const s = useChatStore.getState()
  return findSessionInState(s, sessionId)?.isRunning ?? false
}

/**
 * DATA PLANE — mounted ONCE (in ChatPage). Owns the single realtime WebSocket
 * subscription that multiplexes every session's firehose, demuxes frames by their
 * tagged sessionId, and writes PER-SESSION store state (isRunning, pendingInteraction
 * via applyStreamEventToSession) plus the user-wide attention roster. No local React state
 * and no notion of "the active session" beyond focused-only toasts — so any number
 * of ChatSurfaces can read their own slice without a shared mirror.
 */
export function useChatEventStream(enabled = true): void {
  const lastActivityRef = useRef<number>(0)
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
              const store = useChatStore.getState()
              store._replaceSession(session)
              store._setSessionRunning(sessionId, session.isRunning)
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
          const store = useChatStore.getState()
          store._replaceSession(session)
          store._setSessionRunning(session.id, session.isRunning)
        },
      }),
    [],
  )

  // Apply one demultiplexed firehose frame. `sessionId` is the publish (routing)
  // key the backend tagged the frame with. Everything lands in per-session store
  // state; the only active-session branch left is the focused retry toast.
  const handleSessionEvent = useCallback((sessionId: string, parsed: AgentStreamEvent) => {
    if (parsed.type === 'run.started') {
      if (parsed.agentId) answerClock.start(sessionId, parsed.agentId)
      else answerClock.end(sessionId)
    } else if (parsed.type === 'run.completed' || parsed.type === 'run.failed') {
      answerClock.end(sessionId)
    }
    // Forward SAFE lifecycle signals (run start/completed/failed) to bridged
    // plugin views. Additive + non-consuming: the SDK allow-list gates what
    // crosses, and every other branch below still runs unchanged.
    routePluginSessionEvent(sessionId, parsed.type)
    if (parsed.type === 'plugin.command') {
      routePluginCommand(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.updated') {
      routePreviewUpdated(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.command') {
      routePreviewCommand(sessionId, parsed)
      return
    }
    if (parsed.type === 'preview.closed') {
      routePreviewClosed(sessionId, parsed)
      return
    }
    if (parsed.type === 'fs.changed') {
      routeFsChanged(sessionId, parsed)
      routeFsDocumentsOpened(sessionId, parsed)
      routeFollowAgentEdits(sessionId, parsed)
      return
    }
    if (parsed.type === 'terminal.opened') {
      routeTerminalOpened(sessionId, parsed)
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

    // Plugin-contributed session-event handlers (host.sessionEvents.register) —
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

    // The Event Center rows for these frames (runs, requests, mentions, terminals, plugin
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
    lastActivityRef.current = Date.now()
    const offEvent = eventSocket.onSessionEvent((sid, parsed) => {
      if (sid === useChatStore.getState().activeSessionId) lastActivityRef.current = Date.now()
      handleSessionEvent(sid, parsed)
    })
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

  // Watchdog: if the focused session is generating but the firehose has gone quiet
  // for 15s, reconcile it from the DB (a missed terminal event would otherwise
  // leave the composer stuck generating).
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeRunning = useChatStore((state) => {
    const id = state.activeSessionId
    if (!id) return false
    return findSessionInState(state, id)?.isRunning ?? false
  })
  useEffect(() => {
    if (!enabled || !activeSessionId || !activeRunning) return
    lastActivityRef.current = Date.now()
    const timer = setInterval(() => {
      if (
        useChatStore.getState().activeSessionId !== activeSessionId ||
        !sessionRunning(activeSessionId)
      )
        return
      if (Date.now() - lastActivityRef.current > 15_000) {
        reconcileSession(activeSessionId)
        lastActivityRef.current = Date.now()
      }
    }, 5_000)
    return () => clearInterval(timer)
  }, [enabled, activeSessionId, activeRunning, reconcileSession])
}

export interface SessionRuntime {
  pendingInteraction: PendingHitlInteraction | null
  submittingInteractionId: string | null
  answerInteraction: (requestId: string, answers: unknown) => boolean
  /** request_secret only: sends the typed value over the isolated submit-secret channel. */
  submitSecretValue: (requestId: string, value: string) => void
  dismissInteraction: (requestId: string) => void
  deferInteraction: (requestId: string) => void
  sendMessage: (
    prompt: string,
    opts: AgentOptions,
    bindings?: MessageBinding[],
    /** Hide the user turn (machine-composed prompt, e.g. the analysis wizard). */
    isInternal?: boolean,
  ) => Promise<void>
  stopGeneration: () => void
  regenerate: (opts: AgentOptions) => Promise<void>
}

/**
 * VIEW PLANE — one per mounted ChatSurface, bound to its OWN `sessionId`. Reads
 * the session's pending interaction straight from the store (populated by the data
 * plane) and exposes the per-session actions (send/regenerate/stop/answer/dismiss).
 * `submittingInteractionId` is local so each overlay tracks its own in-flight answer.
 */
export function useSessionRuntime(sessionId: string | null): SessionRuntime {
  const [submittingInteractionId, setSubmittingInteractionId] = useState<string | null>(null)

  // Declare this surface's session to the SCOPED firehose. The server streams a session's full
  // event flow (message deltas, panels, its children's activity) only to a connection that says it
  // is rendering that session — everything else arrives as roster frames. This hook is the one
  // place a session becomes RENDERED (a mounted ChatSurface calls it, background surfaces
  // included), which is exactly the boundary the declaration should follow; the refcount lives in
  // eventSocket so several surfaces on one session collapse to a single declaration.
  useEffect(() => {
    if (!sessionId) return
    return eventSocket.watchSession(sessionId)
  }, [sessionId])

  const pendingInteraction = useChatStore((state) => {
    if (!sessionId) return null
    return findSessionInState(state, sessionId)?.pendingInteraction ?? null
  })

  // Clear THIS session's pending HITL after resolving it, guarded on requestId so a
  // newer request (B opened before A's RPC resolved) isn't hidden.
  const clearResolvedInteraction = useCallback(
    (requestId: string) => {
      if (!sessionId) return
      // The reader two functions up is `findSessionInState(...)?.pendingInteraction`,
      // i.e. the allSessions fallback — so a ChatSurface bound to a sub-session answered
      // the prompt and the overlay never dismissed.
      useChatStore.setState((state) =>
        patchSessionById(state, sessionId, (s) =>
          s.pendingInteraction?.request.id === requestId ? { ...s, pendingInteraction: null } : s,
        ),
      )
    },
    [sessionId],
  )

  const answerInteraction = useCallback(
    (requestId: string, answers: unknown) => {
      setSubmittingInteractionId(requestId)
      void backendClient
        .interact(requestId, 'respond', { answers })
        .then(() => clearResolvedInteraction(requestId))
        .catch((err: unknown) => {
          const code = err instanceof ApiError ? err.code : null
          if (code === 'hitl_request_not_active') {
            clearResolvedInteraction(requestId)
            recoverInactiveHitlSession(sessionId)
            toast.info('The interaction is no longer active')
          } else {
            toast.error('Could not send your answer', {
              description: errorMessage(err, '') || undefined,
            })
          }
        })
        .finally(() => setSubmittingInteractionId(null))
      return true
    },
    [clearResolvedInteraction, sessionId],
  )

  // request_secret answers ride backendClient.submitSecret — NOT interact — so the
  // typed value goes straight to the server's encrypted vault and never enters the
  // shared HITL respond path. Mirrors answerInteraction otherwise.
  const submitSecretValue = useCallback(
    (requestId: string, value: string) => {
      setSubmittingInteractionId(requestId)
      void backendClient
        .submitSecret(requestId, value)
        .then(() => clearResolvedInteraction(requestId))
        .catch((err: unknown) => {
          const code = err instanceof ApiError ? err.code : null
          if (code === 'secret_request_not_active' || code === 'hitl_request_not_active') {
            clearResolvedInteraction(requestId)
            recoverInactiveHitlSession(sessionId)
            toast.info('The interaction is no longer active')
          } else {
            toast.error('Could not send the secret', {
              description: errorMessage(err, '') || undefined,
            })
          }
        })
        .finally(() => setSubmittingInteractionId(null))
    },
    [clearResolvedInteraction, sessionId],
  )

  const dismissInteraction = useCallback(
    (requestId: string) => {
      void backendClient
        .interact(requestId, 'dismiss')
        .then(() => clearResolvedInteraction(requestId))
        .catch((err: unknown) => {
          const code = err instanceof ApiError ? err.code : null
          if (code === 'hitl_request_not_active') {
            clearResolvedInteraction(requestId)
            recoverInactiveHitlSession(sessionId)
          } else {
            toast.error('Could not dismiss the request', {
              description: errorMessage(err, '') || undefined,
            })
          }
        })
    },
    [clearResolvedInteraction, sessionId],
  )

  const deferInteraction = useCallback(
    (requestId: string) => {
      setSubmittingInteractionId(requestId)
      void backendClient
        .interact(requestId, 'defer')
        .then(() => clearResolvedInteraction(requestId))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === 'hitl_request_not_active') {
            clearResolvedInteraction(requestId)
            recoverInactiveHitlSession(sessionId)
          } else {
            toast.error('Could not save the question for later', {
              description: errorMessage(err, '') || undefined,
            })
          }
        })
        .finally(() => setSubmittingInteractionId(null))
    },
    [clearResolvedInteraction, sessionId],
  )

  const sendMessage = useCallback(
    async (
      prompt: string,
      _opts: AgentOptions,
      bindings?: MessageBinding[],
      isInternal?: boolean,
    ) => {
      if (!sessionId) return
      // The one shared send path (instant optimistic paint + failure cleanup +
      // toast) — the plugin-panel bridge routes through the same helper.
      await sendChatMessage(sessionId, prompt, {
        bindings,
        isInternal,
      })
    },
    [sessionId],
  )

  // SessionRuntime advertises AgentOptions for forward-compat, but the impl takes
  // none: the backend re-runs with the session's own model/effort (same as
  // sendMessage, which likewise ignores its opts). A 0-arg fn satisfies the
  // 1-arg interface type, so callers still pass opts harmlessly.
  const regenerate = useCallback(async () => {
    if (!sessionId || sessionRunning(sessionId)) return
    const state = useChatStore.getState()
    state._setSessionRunning(sessionId, true)
    // patchSessionById, not a `sessions`-only map: a sub-session / cross-project
    // surface resolves its session out of allSessions and would otherwise keep
    // showing the stale reply until the first delta.
    useChatStore.setState((current) =>
      patchSessionById(current, sessionId, (session) => {
        const assistantIndex = [...session.messages]
          .reverse()
          .findIndex((message) => message.role === 'assistant')
        if (assistantIndex === -1) return session
        const index = session.messages.length - 1 - assistantIndex
        return {
          ...session,
          messages: session.messages.map((message, messageIndex) =>
            messageIndex === index
              ? {
                  ...message,
                  content: '',
                  reasoning: undefined,
                  items: undefined,
                  dataParts: undefined,
                  usage: undefined,
                  cacheDiagnostics: undefined,
                  status: undefined,
                }
              : message,
          ),
          // Point the streaming visuals at the blanked row so click→skeleton has
          // no void frame; the server's run.started (new sibling row) re-points.
          streamingMessageId: session.messages[index].id,
        }
      }),
    )
    try {
      const projectId = findSessionInState(state, sessionId)?.projectId ?? null
      await backendClient.regenerate(sessionId, projectId)
    } catch (err) {
      state._setSessionRunning(sessionId, false)
      void backendClient
        .getSession(sessionId)
        .then((session) => {
          useChatStore.getState()._replaceSession(session)
        })
        .catch(() => {})
      throw err
    }
  }, [sessionId])

  const stopGeneration = useCallback(() => {
    if (sessionId) useChatStore.getState().stopGeneration(sessionId)
  }, [sessionId])

  return useMemo(
    () => ({
      pendingInteraction,
      submittingInteractionId,
      answerInteraction,
      submitSecretValue,
      dismissInteraction,
      deferInteraction,
      sendMessage,
      stopGeneration,
      regenerate,
    }),
    [
      answerInteraction,
      submitSecretValue,
      dismissInteraction,
      deferInteraction,
      pendingInteraction,
      regenerate,
      sendMessage,
      stopGeneration,
      submittingInteractionId,
    ],
  )
}
