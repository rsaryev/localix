import type { Project, UiSession } from '@/shared/api/contracts'
import { useChatStore } from './store'

/**
 * The chat store's sync layer: the one place a server answer lands in the store. A reconcile
 * after a reconnect, a refetch after a failed write, and a write whose caller needs the result
 * at once (a fork it navigates into, a branch it shows) all apply the server's copy here, so no
 * surface patches the store with its own idea of a session. The store merges the body over the
 * stored copy, keeping optimistic rows and the live stream target.
 */
export function applyServerSession(session: UiSession, options?: { running?: boolean }): void {
  const store = useChatStore.getState()
  store._replaceSession(session)
  if (options?.running !== undefined) store._setSessionRunning(session.id, options.running)
}

/** The fetched project roster, from the relay's projects resource or an explicit reload. */
export function applyServerProjects(projects: Project[]): void {
  useChatStore.getState()._hydrateProjects(projects)
}
