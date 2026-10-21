import type { UiSession } from '@/shared/api/contracts'
import type { Message } from './types'
import { sortSessions } from './sessionListHelpers'
import { findSessionInState } from './findSession'
import { mergeSessionBody } from './mergeSessionBody'
import type { WarmSessionBodyCache } from './sessionBodyCache'
import type { ChatStore } from './store'

export function logCurrentChatMessages(sessionId: string, messages: Message[]): void {
  // Dev-only and deliberately shallow: dumping the raw message array (full
  // content/reasoning/tool parts) makes DevTools retain every opened dialog's
  // messages forever and made switching to heavy sessions noticeably slow.
  if (!import.meta.env.DEV) return
  console.info(`[Localix chat] opened session ${sessionId}: ${messages.length} messages`)
}

export function activateSessionBody(
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
