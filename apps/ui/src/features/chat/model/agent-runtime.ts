import { useCallback, useEffect, useMemo, useState } from 'react'

import type { MessageBinding } from '@localixai/api/client'
import { toast } from '@/shared/lib/notify'
import { sendChatMessage } from './sendChatMessage'
import { ApiError, backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import type {
  PendingAskInteraction,
  PendingRequestSecretInteraction,
  UiPendingHitlInteraction as PendingHitlInteraction,
} from '@/shared/api/contracts'
import type { ReasoningEffort } from './reasoning'
import { useChatStore } from './store'
import { findSessionInState } from './findSession'
import { patchSessionById } from './sessionListHelpers'
import { recoverInactiveHitlSession } from './hitlInteraction'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

// The data plane (one realtime subscription for every session) lives in chatEventStream.ts.
export { useChatEventStream } from './chatEventStream'

export interface AgentOptions {
  model: string
  reasoningEffort: ReasoningEffort
}

// Pending-interaction types are owned by shared/api/contracts (the UI shape of
// the API HITL contract); re-exported here to keep existing call sites stable.
export type { PendingAskInteraction, PendingRequestSecretInteraction }
export type { PendingHitlInteraction }

/** Read one session's `isRunning` from the store (working list → roster). */
function sessionRunning(sessionId: string | null): boolean {
  if (!sessionId) return false
  const s = useChatStore.getState()
  return findSessionInState(s, sessionId)?.isRunning ?? false
}

export interface SessionRuntime {
  pendingInteraction: PendingHitlInteraction | null
  submittingInteractionId: string | null
  answerInteraction: (requestId: string, answers: unknown) => boolean
  /** request_secret only: sends the typed value over the isolated submit-secret channel. */
  submitSecretValue: (requestId: string, value: string) => void
  dismissInteraction: (requestId: string) => void
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
      sendMessage,
      stopGeneration,
      regenerate,
    }),
    [
      answerInteraction,
      submitSecretValue,
      dismissInteraction,
      pendingInteraction,
      regenerate,
      sendMessage,
      stopGeneration,
      submittingInteractionId,
    ],
  )
}
