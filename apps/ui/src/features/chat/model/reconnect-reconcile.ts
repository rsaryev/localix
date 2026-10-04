export const RECONNECT_RECONCILE_ATTEMPTS = 2

export interface ReconnectReconcileOptions<T extends { id: string }> {
  sessionId: string
  /** Current reducer-owned object identity for this session. */
  getCurrent: () => T | undefined
  /** Active focus at apply time; prevents a late request replacing a session the user left. */
  isStillTarget: () => boolean
  fetchSession: () => Promise<T>
  applySession: (session: T) => void
  attempts?: number
}

/**
 * Reconcile a reconnect gap without allowing an older REST snapshot to overwrite
 * WebSocket replay that lands while the request is in flight. Object identity is
 * the reducer's generation token: every accepted stream event replaces the session.
 */
export async function reconcileAfterReconnect<T extends { id: string }>(
  options: ReconnectReconcileOptions<T>,
): Promise<boolean> {
  const attempts = options.attempts ?? RECONNECT_RECONCILE_ATTEMPTS
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!options.isStillTarget()) return false
    const before = options.getCurrent()
    if (!before) return false
    const snapshot = await options.fetchSession()
    if (!options.isStillTarget()) return false
    const current = options.getCurrent()
    if (current !== before) continue
    if (snapshot.id !== options.sessionId) return false
    options.applySession(snapshot)
    return true
  }
  return false
}
