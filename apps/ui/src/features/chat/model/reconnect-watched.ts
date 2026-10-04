import { reconcileAfterReconnect } from './reconnect-reconcile'

/**
 * Resync every BACKGROUND session a surface still renders after the socket comes back.
 *
 * The defect: a reconnect reconciled only the active session. A background ChatSurface (an
 * editor-grid tab) watches its own session, so it was mid-stream when the API restarted — and the
 * frames that would have finished that body (the final delta, `run.completed`, a terminal wait's
 * settle) are live-only and never replayed. The tab kept a half-streamed reply and a lingering
 * "Waiting for background terminal" until someone focused it.
 *
 * What that forces:
 * - the set to repair is exactly what `eventSocket` declares watched, minus the active session
 *   (its own reconcile owns it, with the user-facing failure toast);
 * - only sessions whose BODY is loaded: a summary has nothing half-streamed, and fetching its
 *   detail would load every transcript the sidebar names;
 * - one request at a time, because a restart reconnects every window at once and N parallel
 *   detail reads per window is the stampede the server just came back from;
 * - a newer reconnect supersedes the walk instead of running beside it;
 * - nothing runs while no session is active: the store's whole-body replace adopts the replaced
 *   session as active when none is, and a background repair must never change the focus.
 */
export interface WatchedReconcileDeps<T extends { id: string; bodyLoaded?: boolean }> {
  watchedIds: () => string[]
  activeId: () => string | null
  getSession: (sessionId: string) => T | undefined
  fetchSession: (sessionId: string) => Promise<T>
  applySession: (session: T) => void
}

export function createWatchedSessionsReconciler<T extends { id: string; bodyLoaded?: boolean }>(
  deps: WatchedReconcileDeps<T>,
): () => Promise<void> {
  let generation = 0
  return async () => {
    const mine = ++generation
    const isTarget = (sessionId: string) => {
      const active = deps.activeId()
      return (
        generation === mine &&
        active !== null &&
        active !== sessionId &&
        deps.watchedIds().includes(sessionId)
      )
    }
    for (const sessionId of deps.watchedIds()) {
      if (generation !== mine) return
      if (!isTarget(sessionId)) continue
      if (deps.getSession(sessionId)?.bodyLoaded === false) continue
      try {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential on purpose: one detail read at a time after a restart, not a stampede
        await reconcileAfterReconnect({
          sessionId,
          getCurrent: () => deps.getSession(sessionId),
          isStillTarget: () => isTarget(sessionId),
          fetchSession: () => deps.fetchSession(sessionId),
          applySession: deps.applySession,
        })
      } catch {
        // A background repair has no one to tell; the session reloads when it is opened.
      }
    }
  }
}
