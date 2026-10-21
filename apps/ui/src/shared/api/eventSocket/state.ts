/**
 * The one socket's mutable state, shared by the modules that make up `eventSocket`.
 *
 * The transport is tab-global — one WebSocket for every live server→client event — so its state
 * is too. ES module bindings cannot be reassigned from another module, which is why it lives on
 * one object here rather than as `let`s spread over transport, reconnect, dispatch and RPC:
 * each of those needs to see (and several need to replace) the SAME socket and cursor.
 */

import { backoffMs } from '@localixai/api/backoff'

const RECONNECT_BACKOFF = { baseMs: 1_000, maxMs: 8_000 }

/** Wait before reconnect number `attempt` (0-based): 1s, doubling, capped at 8s. */
export function reconnectDelayMs(attempt: number): number {
  return backoffMs(attempt, RECONNECT_BACKOFF)
}

export const conn = {
  socket: null as WebSocket | null,
  /** The last session frame a reducer APPLIED — the resume point a reconnect sends as `since`. */
  lastCursor: null as string | null,
  /** The cursor the current socket was dialled with (its `since`), or null for a fresh stream. */
  dialCursor: null as string | null,
  /** When the last socket went down; a replay is trusted only after a short outage. */
  lastDownAt: null as number | null,
  /**
   * Whether the current open resumed after a short outage from a cursor, so the server replays
   * every frame missed since it. Withdrawn (with a resync notice) by a lag marker or by a first
   * frame from another server epoch.
   */
  openResumed: false,
  /** The epoch the first frame after a resumed open must carry; null once checked. */
  verifyEpoch: null as string | null,
  /** Survives an idle teardown: a later open is still a REconnect for a tab holding state. */
  everOpened: false,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  /**
   * Final release is deferred by one task. React development StrictMode performs effect
   * setup → cleanup → setup synchronously; closing during that probe creates a second socket
   * and a noisy browser warning even though a committed subscriber already exists. A real
   * unmount still tears down before the next paint.
   */
  idleDisconnectTimer: null as ReturnType<typeof setTimeout> | null,
  /** Reconnects scheduled since the last successful open; the next wait is derived from it. */
  reconnectAttempt: 0,
  /** A connect is parked behind the desktop shell's startup barrier (see `connect`). */
  waitingForRuntime: false,
  /** Live subscribers plus in-flight requests; the socket stays open while > 0. */
  refCount: 0,
  nextRequestId: 0,
  /** Messages enqueued before the socket is OPEN; flushed on connect, dropped on close. */
  outbound: [] as string[],
  /** One warning per runtime for an unaddressable API (see `connect`). */
  unaddressableReported: false,
}

export function isOpen(socket: WebSocket | null): socket is WebSocket {
  return socket !== null && socket.readyState === WebSocket.OPEN
}

/**
 * Test reset. The caller clears the timers first; `waitingForRuntime` is left alone because a
 * parked connect still holds the barrier's promise and will clear it itself.
 */
export function resetConnState(): void {
  conn.socket = null
  conn.lastCursor = null
  conn.dialCursor = null
  conn.lastDownAt = null
  conn.openResumed = false
  conn.verifyEpoch = null
  conn.everOpened = false
  conn.reconnectTimer = null
  conn.idleDisconnectTimer = null
  conn.reconnectAttempt = 0
  conn.refCount = 0
  conn.nextRequestId = 0
  conn.outbound = []
  conn.unaddressableReported = false
}
