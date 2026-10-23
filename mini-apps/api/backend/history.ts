/**
 * Response history — the last few sends of each saved request: send, then flip back through what
 * came before.
 *
 * IN-MEMORY, DELIBERATELY. A response body is the one payload in this mini app that routinely
 * carries real data (user records, tokens the API echoes back) and can be megabytes; persisting
 * it would turn `~/.localix` into an unredacted archive of every API the user ever hit, which is
 * a very different privacy contract from the redacted-specs-only file the store keeps. Losing
 * history on restart is the accepted price, and the UI says "recent", not "all".
 *
 * Keyed per user × session × request name and capped as a ring: newest first, oldest dropped. Held on
 * `globalThis` like the singleton's other state, so the boot load and per-run tool loads (fresh
 * module instances — see singleton.ts) append to the SAME history, and an agent's send shows up
 * in the workbench's dropdown next to the user's own.
 */

import type { HistorySource, SendResponse } from './contracts'
import { redactSpec } from './store'
import type { RequestSpec } from './request-spec'

export interface HistoryEntry {
  /** Monotonic per-process id — the dropdown's stable key. */
  id: number
  at: number
  response: SendResponse
  /** Whether the agent or the user made this send — the ring is shared, so the row must say. */
  source: HistorySource
  /**
   * The request as it was sent, REDACTED. Snapshotted here rather than joined to the saved record
   * on read: the saved request may be edited between the send and the read, and a row that showed
   * the current spec would attribute this response to a request it never came from.
   */
  request?: RequestSpec
}

const CAP = 10

/**
 * Global bounds, because the per-request ring alone bounded nothing: keys are user × session ×
 * request and were only ever dropped by a delete or a rename, so every session that sent a request
 * added a ring of up to ten bodies (each up to the 1 MB send cap) that lived until the process
 * exited — an agent calling `api_client` across many sessions grew the API process without limit.
 * Keys are kept in least-recently-SENT order (the Map's insertion order, refreshed on each send),
 * and eviction takes the oldest entry of the stalest key until both bounds hold.
 */
const MAX_KEYS = 256
const MAX_BODY_CHARS = 32 * 1024 * 1024

interface HistoryState {
  nextId: number
  byKey: Map<string, HistoryEntry[]>
}

const GLOBAL_KEY = '__localix_rest_api_client_history__'

function state(): HistoryState {
  const g = globalThis as unknown as Record<string, HistoryState | undefined>
  return (g[GLOBAL_KEY] ??= { nextId: 1, byKey: new Map() })
}

const keyOf = (userId: string, name: string, sessionId?: string) =>
  `${userId}\u0000${sessionId ?? ''}\u0000${name}`

/**
 * Drop the whole ring — a TEST seam, and the reason it exists is `scripts/test-globals-guard.ts`:
 * the ring lives on `globalThis` (see the header), so a suite that records a send leaves a key
 * behind for every later test FILE in the run, which the guard fails as a new leak. Deleting the
 * key rather than reassigning it is deliberate: an assignment leaves the property in place and the
 * guard reads keys, not values.
 */
export function resetHistory(): void {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY]
}

/**
 * Record one send. `source` says who made it; `spec`, when given, is snapshotted REDACTED here —
 * redaction lives in this one place so no caller can record a literal credential by forgetting to
 * mask first, the same "guard where nothing can forget it" rule the send path follows.
 */
export function recordSend(
  userId: string,
  name: string,
  response: SendResponse,
  source: HistorySource,
  spec?: RequestSpec,
  sessionId?: string,
): void {
  const s = state()
  const key = keyOf(userId, name, sessionId)
  const list = s.byKey.get(key) ?? []
  list.unshift({
    id: s.nextId++,
    at: Date.now(),
    response,
    source,
    ...(spec ? { request: redactSpec(spec) } : {}),
  })
  if (list.length > CAP) list.length = CAP
  // Delete-then-set moves the key to the fresh end of the Map, which is the LRU order.
  s.byKey.delete(key)
  s.byKey.set(key, list)
  evict(s, key)
}

/** Enforce {@link MAX_KEYS} and {@link MAX_BODY_CHARS}, never touching the key just written. */
function evict(s: HistoryState, keep: string): void {
  let chars = 0
  for (const list of s.byKey.values()) {
    for (const entry of list) chars += entry.response.body.length
  }
  for (const [key, list] of s.byKey) {
    if (s.byKey.size <= MAX_KEYS && chars <= MAX_BODY_CHARS) return
    if (key === keep) continue
    if (s.byKey.size > MAX_KEYS) {
      for (const entry of list) chars -= entry.response.body.length
      s.byKey.delete(key)
      continue
    }
    while (list.length > 0 && chars > MAX_BODY_CHARS) chars -= list.pop()!.response.body.length
    if (list.length === 0) s.byKey.delete(key)
  }
}

/** The bounds, for tests that prove eviction without allocating 32 MB of fixtures by hand. */
export const HISTORY_LIMITS = { maxKeys: MAX_KEYS, maxBodyChars: MAX_BODY_CHARS } as const

/** Newest first. A request with no sends yet is an empty list, not an error. */
export function listHistory(userId: string, name: string, sessionId?: string): HistoryEntry[] {
  return [...(state().byKey.get(keyOf(userId, name, sessionId)) ?? [])]
}

/** A deleted request must not resurrect its responses under a later namesake. */
export function dropHistory(userId: string, name: string, sessionId?: string): void {
  state().byKey.delete(keyOf(userId, name, sessionId))
}

/** A rename keeps its history — the responses were this request's, whatever it is called now. */
export function renameHistory(userId: string, from: string, to: string, sessionId?: string): void {
  const s = state()
  const list = s.byKey.get(keyOf(userId, from, sessionId))
  s.byKey.delete(keyOf(userId, from, sessionId))
  if (list) s.byKey.set(keyOf(userId, to, sessionId), list)
}
