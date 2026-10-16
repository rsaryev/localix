import { sessionRoute, type UiSession } from '@/shared/api/contracts'

interface SessionConnectionState {
  sessions: readonly Pick<UiSession, 'id' | 'agents'>[]
  allSessions: readonly Pick<UiSession, 'id' | 'agents'>[]
}

export function selectSessionConnectionId(
  state: SessionConnectionState,
  sessionId: string | null,
): string | null {
  // Match the session resolution used by ChatSurface/useSessionById. During a
  // cross-scope New Chat transition the URL has already focused the new session,
  // but the scope-filtered `sessions` list may not contain it yet; `allSessions`
  // does. Looking only in `sessions` made the model persist on the backend while
  // the active picker kept rendering "Choose model" until another navigation
  // rebuilt the working list.
  const found =
    state.sessions.find((session) => session.id === sessionId) ??
    state.allSessions.find((session) => session.id === sessionId)
  // The composer's connection chip speaks for the session's own participant. In a group each
  // member has its own, and the per-member picker asks for theirs by handle.
  return found ? sessionRoute(found).providerConnectionId : null
}
