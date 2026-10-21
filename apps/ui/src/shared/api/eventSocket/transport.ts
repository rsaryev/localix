import { runtimeReadyBarrier } from '../../lib/runtimeReady'
import { WS_BASE_URL } from '../internal'
import { dispatchFrame } from './dispatch'
import {
  emitRealtimeDiagnostic,
  notifyConnectedHandlers,
  notifyDisconnectHandlers,
  notifyReconnectHandlers,
} from './observers'
import { parseSessionCursor } from '@localixai/api/ws-frame'
import { cancelIdleDisconnect, failAllPending } from './refcount'
import { conn, isOpen, reconnectDelayMs } from './state'
import { declareWatchedAtConnect, reconcileWatchedSessions } from './subscription'

/**
 * Dialling, opening, closing and redialling the one socket.
 *
 * ONE WebSocket carries every live server→client event (chat session firehose + plugin streams).
 * Browsers cap HTTP/1.1 at 6 concurrent connections PER ORIGIN shared across ALL tabs, so the
 * previous fleet of SSE EventSources (chat firehose + a stream per subscriber, per tab) exhausted the pool and hung page loads once two tabs were open. WebSockets live under a
 * separate, much larger budget and carry no per-frame HTTP overhead.
 */

/**
 * The socket URL, or null when this runtime has no addressable API.
 *
 * `WS_BASE_URL` is normally an absolute http(s) origin (the API directly in dev, since Vite's proxy
 * can't relay WS upgrades under Bun; same-origin in prod). `resolveHttpBase` refuses an unusable
 * page origin, so the `new URL` below should not fail — but it stays guarded and returns null rather
 * than throwing, because this is called from `connect()` ← `retain()`, i.e. inside a subscribe, and a
 * throw there takes down the SUBSCRIBER instead of just leaving realtime unavailable.
 */
function wsUrl(): string | null {
  try {
    const base = WS_BASE_URL.replace(/^http/, 'ws')
    const url = new URL(`${base}/rpc/ws`)
    // Bind the connection itself to the workbench surface. Per-request
    // `toolSurface` still pins the immutable catalog id, but the baseline UI
    // capability can no longer disappear because of a stale/partial queued
    // payload during HMR or reconnect.
    url.searchParams.set('surface', 'workbench')
    // Resume from the last seen event id so a reconnect replays what it missed.
    if (conn.lastCursor) url.searchParams.set('since', conn.lastCursor)
    // Scope the firehose from the FIRST frame. A reconnect that waited for a `session.watch`
    // command would spend the round-trip roster-only, and the open transcript's deltas published in
    // that window are live-only — dropped for good, i.e. a visible mid-stream stall.
    const watched = declareWatchedAtConnect()
    if (watched.length > 0) url.searchParams.set('watch', watched.join(','))
    return url.toString()
  } catch {
    return null
  }
}

function flushOutbound(): void {
  if (!isOpen(conn.socket)) return
  for (const text of conn.outbound) conn.socket.send(text)
  conn.outbound = []
}

/**
 * Park the connect behind the desktop shell's startup barrier. A handshake against a sidecar that
 * is not listening yet is a guaranteed failure that also costs a backoff step for a service that
 * was never down; the shell announces when its API child is up.
 */
function parkBehindRuntime(): boolean {
  if (conn.waitingForRuntime) return false
  const barrier = runtimeReadyBarrier()
  if (!barrier) return false
  conn.waitingForRuntime = true
  void barrier.then(() => {
    conn.waitingForRuntime = false
    if (conn.refCount > 0 && !conn.socket) connect()
  })
  return true
}

/** No addressable API: stay disconnected instead of throwing out of `retain()`, reported once. */
function reportUnaddressable(): void {
  if (conn.unaddressableReported) return
  conn.unaddressableReported = true
  console.warn(
    `[eventSocket] no usable API origin (${WS_BASE_URL || 'empty'}) — realtime updates are off`,
  )
  emitRealtimeDiagnostic({
    kind: 'connection.unaddressable',
    severity: 'error',
    summary: 'Realtime connection is unavailable',
    message: 'The configured API address cannot be used for realtime updates.',
  })
}

/**
 * The server replays every frame after `since` from its ring, within one boot. An outage longer
 * than this may have outrun that ring, which sends no marker when it does, so the open is then
 * treated as a fresh stream.
 */
export const REPLAY_TRUST_MS = 30_000

function markResumed(): void {
  const cursor = conn.dialCursor ? parseSessionCursor(conn.dialCursor) : null
  conn.openResumed =
    cursor !== null && conn.lastDownAt !== null && Date.now() - conn.lastDownAt <= REPLAY_TRUST_MS
  conn.verifyEpoch = conn.openResumed ? cursor!.epoch : null
}

export function connect(): void {
  if (conn.socket) return
  if (parkBehindRuntime()) return
  const url = wsUrl()
  if (url === null) return reportUnaddressable()
  const ws = new WebSocket(url)
  conn.socket = ws
  conn.dialCursor = conn.lastCursor

  // Every handler below mutates the shared state, so each must first confirm it
  // still belongs to the CURRENT socket. A socket close is delivered on a future
  // task (a browser never fires `onclose` synchronously from `close()`), so by the
  // time a superseded socket's `onclose`/`onopen` fires — after a release→retain
  // churn (React StrictMode remount, Vite HMR) opened a replacement — `socket`
  // already points at the newer live socket. Without this identity guard a stale
  // close would null out the live socket, clear ITS `outbound` queue, reject ITS
  // in-flight requests, and schedule a duplicate reconnect — leaking an
  // unreferenced but still-open socket (the "several simultaneous /rpc/ws
  // connections" bug).
  ws.onopen = () => {
    if (conn.socket !== ws) return
    conn.reconnectAttempt = 0
    markResumed()
    // A reconnect (not the first open) may have missed events the server buffer
    // already evicted — let subscribers reconcile authoritative state.
    if (conn.everOpened) notifyReconnectHandlers()
    conn.everOpened = true
    // EVERY open, including the first. A first connect declares no cursor, so the
    // server replays nothing to it — anything published between the runtime
    // starting and this socket arriving is simply gone. On a cold desktop start
    // that window is real and holds the boot `resources.changed` poke the backend
    // host emits when its wiring settles. Reading after subscribing is what makes
    // the pair total: a change before this point is in the read, one after it is
    // on the wire.
    notifyConnectedHandlers()
    reconcileWatchedSessions()
    flushOutbound()
  }
  ws.onmessage = (ev) => {
    if (conn.socket !== ws) return
    if (typeof ev.data === 'string') dispatchFrame(ev.data)
  }
  ws.onclose = () => {
    // Stale close: this socket was already superseded (or torn down by release);
    // the live socket, its queue, and its in-flight requests belong to a newer
    // socket, so stay completely inert.
    if (conn.socket !== ws) return
    conn.socket = null
    conn.lastDownAt = Date.now()
    conn.openResumed = false
    conn.verifyEpoch = null
    // Drop queued frames together with the requests rejected below. Sending a
    // stale queued frame after reconnect would double-apply a request whose
    // caller already saw a failure.
    conn.outbound = []
    failAllPending()
    // Say so AT the moment we go down. `onReconnect` fires when the socket comes
    // BACK — the opposite moment — so a subscriber gating a fallback on liveness had
    // no way to learn it had gone blind, and kept believing the stream was healthy
    // for the whole outage: exactly the window where the fallback is the only feed.
    notifyDisconnectHandlers()
    scheduleReconnect()
  }
  ws.onerror = () => {
    if (conn.socket !== ws) return
    // Surface as a close so reconnect logic runs in one place.
    ws.close()
  }
}

/** Exponential backoff, reset by the next successful open. */
function scheduleReconnect(): void {
  if (conn.refCount === 0) return
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  conn.reconnectTimer = setTimeout(
    () => {
      conn.reconnectTimer = null
      if (conn.refCount > 0) connect()
    },
    reconnectDelayMs(conn.reconnectAttempt++),
  )
}

export function retain(): void {
  cancelIdleDisconnect()
  conn.refCount += 1
  if (conn.refCount === 1) connect()
}
