/**
 * eventSocket — the single realtime transport for the whole tab.
 *
 * One WebSocket carries every live server→client event and the client→server RPCs that ride it.
 * This module is the public surface; each responsibility behind it has its own file under
 * `eventSocket/`, because while they shared one 1000-line module every one of them could reach
 * every piece of mutable state, and the identity and ordering rules that keep them apart could
 * only be checked by reading the whole thing:
 *
 *   transport.ts       dial, open, close and redial the socket (backoff, startup barrier)
 *   refcount.ts        keep it open exactly while a subscriber or request needs it
 *   subscription.ts    who receives what: handler registries + the watched-session scope
 *   dispatch.ts        route one wire frame to its consumers
 *   session-frames.ts  coalesce the session firehose into one render pass per tick
 *   rpc.ts             correlated request/response over the socket
 *   observers.ts       lifecycle, RPC instrumentation and diagnostics channels
 *   state.ts           the one socket's shared mutable state
 */
import {
  clearObservers,
  connectedHandlers,
  disconnectHandlers,
  realtimeDiagnosticHandlers,
  reconnectHandlers,
  rpcRequestEventHandlers,
  type ConnectionHandler,
  type RealtimeDiagnosticEventHandler,
  type RpcRequestEventHandler,
} from './eventSocket/observers'
import { cancelIdleDisconnect, pendingRequests, release } from './eventSocket/refcount'
import { request } from './eventSocket/rpc'
import { dropSessionFrames } from './eventSocket/session-frames'
import { conn, resetConnState } from './eventSocket/state'
import {
  clearSubscriptions,
  frameHandlers,
  sessionHandlers,
  watchSession,
  watchedSessionIds,
  type FrameHandler,
  type SessionEventHandler,
} from './eventSocket/subscription'
import { connect, retain } from './eventSocket/transport'

export type {
  RealtimeDiagnosticEvent,
  RealtimeDiagnosticSeverity,
  RpcRequestEvent,
  RpcRequestPhase,
} from './eventSocket/observers'
export { SESSION_FLUSH_MS, SESSION_FRAMES_PER_SLICE } from './eventSocket/session-frames'

/** Subscribe `handler` into `set`, holding one transport reference until the unsubscribe. */
function retained<T>(set: Set<T>, handler: T): () => void {
  set.add(handler)
  retain()
  return () => {
    set.delete(handler)
    release()
  }
}

/** Observer-only: joins `set` without retaining the transport. */
function observed<T>(set: Set<T>, handler: T): () => void {
  set.add(handler)
  return () => {
    set.delete(handler)
  }
}

export function resetEventSocketForTests(): void {
  cancelIdleDisconnect()
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  dropSessionFrames()
  const ws = conn.socket
  conn.socket = null
  ws?.close()
  resetConnState()
  for (const [, pending] of pendingRequests) clearTimeout(pending.timer)
  pendingRequests.clear()
  clearSubscriptions()
  clearObservers()
}

export function getEventSocketDebugStateForTests(): {
  refCount: number
  pendingRequests: number
  outbound: number
} {
  return {
    refCount: conn.refCount,
    pendingRequests: pendingRequests.size,
    outbound: conn.outbound.length,
  }
}

/** Execute an already-scheduled reconnect without waiting for production backoff. */
export function runScheduledReconnectForTests(): boolean {
  if (!conn.reconnectTimer) return false
  clearTimeout(conn.reconnectTimer)
  conn.reconnectTimer = null
  if (conn.refCount > 0) connect()
  return true
}

export const eventSocket = {
  isConnected(): boolean {
    return conn.socket?.readyState === WebSocket.OPEN
  },
  /** Subscribe to every session's stream events (demuxed by routing session id). */
  onSessionEvent(handler: SessionEventHandler): () => void {
    return retained(sessionHandlers, handler)
  },
  /**
   * Subscribe to a GENERIC subsystem live-stream frame tagged with `tag` (a single
   * wire char). Backend subsystems (bundled plugins) contribute a live stream that
   * pushes `<tag>\n<payload-json>` frames NOT tied to a chat session — they ride the
   * tab-global socket rather than the per-session firehose. The handler receives the
   * raw payload JSON string (JSON.parse it). The caller starts/stops the server-side
   * stream via its own subscribe/unsubscribe RPCs (see `request`).
   */
  onFrame(tag: string, handler: FrameHandler): () => void {
    let handlers = frameHandlers.get(tag)
    if (!handlers) {
      handlers = new Set()
      frameHandlers.set(tag, handlers)
    }
    handlers.add(handler)
    retain()
    return () => {
      const set = frameHandlers.get(tag)
      if (set) {
        set.delete(handler)
        if (set.size === 0) frameHandlers.delete(tag)
      }
      release()
    }
  },
  /**
   * Declare that this tab is RENDERING `sessionId`, so the server sends its FULL stream (deltas,
   * panels, child activity) instead of roster frames only. Refcounted: call it from every surface
   * bound to a session and release on unmount; the last release drops the declaration.
   *
   * Observer-only with respect to the socket — it does not retain the transport, because a
   * declaration is meaningless without an event subscription and every caller already has one.
   */
  watchSession(sessionId: string): () => void {
    return watchSession(sessionId)
  },
  /** The sessions some surface currently declares it renders — what a reconnect must resync. */
  watchedSessionIds(): string[] {
    return watchedSessionIds()
  },
  /**
   * Fired after a RECONNECT (never the first connect). Observer-only — does not
   * keep the socket open on its own; pair it with an event subscription.
   */
  onReconnect(handler: ConnectionHandler): () => void {
    return observed(reconnectHandlers, handler)
  },
  /**
   * Fired on EVERY open, first connect included — for state whose only delivery is
   * a push frame, where "we were not connected yet" is indistinguishable from
   * "nothing changed". Use {@link onReconnect} instead for state a mount already
   * fetched; this one deliberately fires during startup as well.
   */
  onConnected(handler: ConnectionHandler): () => void {
    return observed(connectedHandlers, handler)
  },
  /**
   * Fired when the socket goes DOWN (a drop, or a first connect that never opened) —
   * the mirror of {@link onReconnect}, which only ever fires on the way back up.
   * Observer-only, like its twin: it does not retain the socket. Subscribe when
   * "frames have stopped arriving" is a state you must ACT on rather than discover
   * later; a liveness flag fed only by `onReconnect` reads "last heard live", not
   * "live", and is stuck true for the entire outage.
   */
  onDisconnect(handler: ConnectionHandler): () => void {
    return observed(disconnectHandlers, handler)
  },
  /** Observer-only RPC instrumentation seam; never retains or mutates the transport. */
  onRequestEvent(handler: RpcRequestEventHandler): () => void {
    rpcRequestEventHandlers.add(handler)
    return () => rpcRequestEventHandlers.delete(handler)
  },
  /** Observer-only integrity channel; payloads and raw frames are never exposed. */
  onDiagnosticEvent(handler: RealtimeDiagnosticEventHandler): () => void {
    realtimeDiagnosticHandlers.add(handler)
    return () => realtimeDiagnosticHandlers.delete(handler)
  },
  /**
   * Client→server RPC over the same socket: assigns a correlation id, sends the
   * payload (queued if the socket is still connecting), and resolves with the
   * server's result (or rejects with an ApiError carrying its code). Used for
   * message sends and HITL responses so they ride the one connection instead of
   * competing for an HTTP slot.
   */
  request<T = unknown>(
    payload: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    return request<T>(payload, options)
  },
}
