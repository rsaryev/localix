import { ApiError } from '../internal'
import { dropSessionFrames } from './session-frames'
import { conn } from './state'

/**
 * The socket stays open exactly while someone needs it: a subscriber or an in-flight request
 * each hold one reference. A request that settles without releasing its reference keeps an idle
 * socket open forever, and one that releases twice closes the socket under a live subscriber —
 * so the pending-request table and the release it owes live together here.
 */

export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
export const pendingRequests = new Map<string, PendingRequest>()

/** Remove a request and release its reference; undefined when it already settled. */
export function settlePending(id: string): PendingRequest | undefined {
  const pending = pendingRequests.get(id)
  if (!pending) return undefined
  pendingRequests.delete(id)
  clearTimeout(pending.timer)
  release()
  return pending
}

/**
 * Fail every in-flight request — the socket that carried them is gone. The caller surfaces the
 * error; nothing auto-retries, because a send may have been processed server-side and a silent
 * replay could double-apply it.
 */
export function failAllPending(): void {
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id)
    clearTimeout(pending.timer)
    release()
    pending.reject(
      new ApiError('The connection to Localix dropped before this finished.', 0, 'ws_closed'),
    )
  }
}

export function release(): void {
  conn.refCount = Math.max(0, conn.refCount - 1)
  if (conn.refCount > 0 || conn.idleDisconnectTimer) return
  conn.idleDisconnectTimer = setTimeout(disconnectIfUnused, 0)
}

export function cancelIdleDisconnect(): void {
  if (conn.idleDisconnectTimer) {
    clearTimeout(conn.idleDisconnectTimer)
    conn.idleDisconnectTimer = null
  }
}

function disconnectIfUnused(): void {
  conn.idleDisconnectTimer = null
  if (conn.refCount > 0) return
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer)
    conn.reconnectTimer = null
  }
  // Keep `everOpened` across an idle teardown. A later subscriber is resuming a
  // tab that already held session state, even though it needs a fresh socket.
  // Treating that open as the first one skips every reconnect reconciliation;
  // if the global replay ring evicted part of the gap, the retained store would
  // then stay stale until the user explicitly reopened the session.
  dropSessionFrames()
  const ws = conn.socket
  conn.socket = null
  ws?.close()
}
