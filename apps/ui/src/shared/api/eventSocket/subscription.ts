import type { AgentStreamEvent } from '../contracts'
import { conn, isOpen } from './state'

/**
 * Who receives what the socket carries: the handler registries the dispatcher fans out to, and
 * the WATCHED set that scopes the session firehose on the server.
 */

export type SessionEventHandler = (sessionId: string, event: AgentStreamEvent) => void
/**
 * A generic subsystem live-stream frame handler — receives the raw payload JSON string for a
 * given single-char frame tag (the caller JSON.parses it). Backs the registry-driven live
 * streams contributed by bundled subsystem plugins.
 */
export type FrameHandler = (json: string) => void

export const sessionHandlers = new Set<SessionEventHandler>()
export const frameHandlers = new Map<string, Set<FrameHandler>>()

// ---------------------------------------------------------------------------
// Watched sessions — the client half of the SCOPED firehose
// ---------------------------------------------------------------------------
// The server sends the FULL stream of a session only to a connection that declared it is rendering
// it; every other session arrives as roster/lifecycle frames only (see the api registry's
// `subscribeScoped`). Unscoped, one chat that had spawned 782 concurrent sub-agents pushed every
// one of their frames into this tab and the whole machine froze.
//
// REFCOUNTED, exactly like the socket itself: several surfaces can render the same session (two
// editor groups, a warm background tab), each declares independently, and only the last release
// drops the declaration. The set is also replayed into the connect URL, so a reconnect is
// correctly scoped from its very first frame rather than after a round-trip.
const watchedSessions = new Map<string, number>()
/** What the CURRENT socket's URL declared — the baseline `onopen` reconciles against. */
let declaredAtConnect: string[] = []
/** Server-side per-command cap (see ws-commands.ts); a larger set is split across commands. */
const WATCH_IDS_PER_COMMAND = 64

function sendWatchCommand(t: 'session.watch' | 'session.unwatch', sessionIds: string[]): void {
  if (sessionIds.length === 0) return
  // Fire-and-forget, NOT `request()`: this is a declaration, not a call — nothing awaits the
  // answer, and routing it through the RPC path would retain the socket and arm a 30s timeout for
  // it. Deliberately not queued into `outbound` either: that queue is dropped on close, whereas
  // `onopen` re-derives the whole truth from `watchedSessions` below.
  if (!isOpen(conn.socket)) return
  conn.socket.send(JSON.stringify({ id: `w${++conn.nextRequestId}`, t, sessionIds }))
}

function sendWatchChunked(t: 'session.watch' | 'session.unwatch', sessionIds: string[]): void {
  for (let i = 0; i < sessionIds.length; i += WATCH_IDS_PER_COMMAND) {
    sendWatchCommand(t, sessionIds.slice(i, i + WATCH_IDS_PER_COMMAND))
  }
}

/** Record what a new socket's URL declares, and return it for the `watch` parameter. */
export function declareWatchedAtConnect(): string[] {
  declaredAtConnect = [...watchedSessions.keys()]
  return declaredAtConnect
}

/**
 * Reconcile the server's watched set with ours the moment the socket opens.
 *
 * The URL declared the set as of `wsUrl()`, but a surface can mount or unmount between dialling and
 * OPEN (the app-wide event subscription retains the socket before any chat surface has mounted, so
 * on a cold start the URL is usually EMPTY and the real declaration happens here). Sending the
 * DIFFERENCE rather than the whole set means the common steady-state reconnect sends nothing.
 */
export function reconcileWatchedSessions(): void {
  const declared = new Set(declaredAtConnect)
  const toWatch: string[] = []
  for (const sessionId of watchedSessions.keys()) {
    if (!declared.has(sessionId)) toWatch.push(sessionId)
  }
  const toUnwatch = declaredAtConnect.filter((sessionId) => !watchedSessions.has(sessionId))
  sendWatchChunked('session.watch', toWatch)
  sendWatchChunked('session.unwatch', toUnwatch)
  declaredAtConnect = [...watchedSessions.keys()]
}

/** See `eventSocket.watchedSessionIds`. */
export function watchedSessionIds(): string[] {
  return [...watchedSessions.keys()]
}

/** See `eventSocket.watchSession`. */
export function watchSession(sessionId: string): () => void {
  const count = watchedSessions.get(sessionId) ?? 0
  watchedSessions.set(sessionId, count + 1)
  if (count === 0) sendWatchCommand('session.watch', [sessionId])
  let released = false
  return () => {
    // Guard double-release: React StrictMode runs cleanup twice, and a second decrement would
    // drop a declaration another mounted surface still owns.
    if (released) return
    released = true
    const current = watchedSessions.get(sessionId) ?? 0
    if (current > 1) {
      watchedSessions.set(sessionId, current - 1)
      return
    }
    watchedSessions.delete(sessionId)
    sendWatchCommand('session.unwatch', [sessionId])
  }
}

export function clearSubscriptions(): void {
  watchedSessions.clear()
  declaredAtConnect = []
  sessionHandlers.clear()
  frameHandlers.clear()
}
