import { routeReadiness, type CatalogModel } from '@localixai/agent/catalog'
import { sessionRoute, type UiSession } from '@/shared/api/contracts'

interface SessionConnectionState {
  sessions: readonly Pick<UiSession, 'id' | 'agents'>[]
  allSessions: readonly Pick<UiSession, 'id' | 'agents'>[]
}

function findSession(state: SessionConnectionState, sessionId: string | null) {
  return (
    state.sessions.find((session) => session.id === sessionId) ??
    state.allSessions.find((session) => session.id === sessionId)
  )
}

/** The model the session's own participant runs on, or '' for none. */
export function selectSessionModelId(
  state: SessionConnectionState,
  sessionId: string | null,
): string {
  const found = findSession(state, sessionId)
  return found ? sessionRoute(found).modelId : ''
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
  const found = findSession(state, sessionId)
  // The composer's connection chip speaks for the session's own participant. In a group each
  // member has its own, and the per-member picker asks for theirs by handle.
  return found ? sessionRoute(found).providerConnectionId : null
}

/**
 * The connection a session's route runs on now, by the server's rule (`routeReadiness`): the
 * stored id is a hint, so a route whose account was deleted and signed in again runs on the new
 * one, and a route with no usable account runs on none. With no model yet, or before the catalog
 * has loaded, the stored id is all there is to go by.
 */
export function runnableConnectionId(input: {
  storedId: string | null
  modelId: string
  connections: readonly { id: string; providerId: string; hasApiKey: boolean }[]
  models: readonly Pick<CatalogModel, 'id' | 'providerId'>[]
}): string | null {
  const { storedId, modelId, connections, models } = input
  if (!modelId || models.length === 0) return storedId
  const readiness = routeReadiness(
    { modelId, providerConnectionId: storedId },
    connections.map((c) => ({ id: c.id, providerId: c.providerId, usable: c.hasApiKey })),
    models,
  )
  return readiness.status === 'ready' ? readiness.connectionId : null
}
