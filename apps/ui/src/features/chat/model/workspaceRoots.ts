/**
 * The chat store's answer to `workspaceOf`: a session's root conversation, remembered.
 *
 * Reading the root only off the session list lost it whenever the row left the list while the
 * session still had things to show: `pruneFinishedSubSessions` evicts sub-session rows (even
 * running ones past the overall cap), a cold start's snapshot replaces the list wholesale, and a
 * reconnect whose replay ring dropped the summary leaves it out. The sub-session then answered as
 * its own root, and its next page or pane opened in a workspace of its own, out of its parent's
 * sight. A session's root is fixed at its birth and never changes, so once seen it is kept for
 * the life of the page — the list's eviction stays a matter of the list.
 */
import { setWorkspaceResolver } from '@/shared/lib/workspaceOf'
import { findSessionInState } from './findSession'

interface SessionTree {
  id: string
  rootSessionId?: string | null
}

interface SessionLists {
  sessions: readonly SessionTree[]
  allSessions: readonly SessionTree[]
}

interface StoreLike {
  getState(): SessionLists
  subscribe(listener: (state: SessionLists) => void): () => void
}

export function registerWorkspaceRoots(store: StoreLike): () => void {
  const roots = new Map<string, string>()
  let seen: readonly SessionTree[] | null = null
  const learn = (state: SessionLists) => {
    // The lists are replaced, never mutated, so an unchanged reference has nothing new to teach.
    if (state.allSessions === seen) return
    seen = state.allSessions
    for (const session of state.allSessions)
      if (session.rootSessionId) roots.set(session.id, session.rootSessionId)
  }
  learn(store.getState())
  const stop = store.subscribe(learn)
  setWorkspaceResolver(
    (id) => findSessionInState(store.getState(), id)?.rootSessionId ?? roots.get(id),
  )
  return stop
}
