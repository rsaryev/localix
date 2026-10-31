/**
 * Frozen per-agent-lane context snapshot.
 *
 * The volatile system-prompt inputs (memory notes, memory usage, user profile,
 * and skills list) are loaded fresh on the FIRST run of a session and
 * then FROZEN for the session's lifetime: subsequent runs reuse the snapshot's
 * strings so the system prompt stays byte-identical across runs — keeping the
 * provider prompt-cache prefix valid for the whole conversation.
 *
 * Semantics: mid-session memory/profile/skill writes still update disk
 * and the DB immediately, but do NOT change the prompt of the CURRENT session.
 * They apply from the next session, or after a natural prompt-rebuild point:
 * a context checkpoint or an explicit /clear. Both start a new model-view epoch
 * (`model-view/view.ts`), which changes the `boundaryMarker` and misses the
 * cache — see `get`. The prefix is rewritten there anyway, so refreshing costs nothing extra.
 *
 * Native agent definitions and execution policy are resolved separately on every run.
 * The cache is generic and in-memory only; production entries use a stable agent-lane key
 * and evicted LRU-ish beyond `maxEntries`.
 */

import { createBoundedCache } from '../../../lib/bounded-cache'

export interface SessionSnapshotCacheOptions {
  /** Max retained sessions; the least-recently-used entry beyond this is evicted. Default 200. */
  maxEntries?: number
  /** When false the cache is inert (get always misses, set/invalidate are no-ops). Default true. */
  enabled?: boolean
}

export interface SessionSnapshotCache<T> {
  readonly enabled: boolean
  /**
   * Return the frozen snapshot for the session, or undefined when absent OR when
   * `boundaryMarker` differs from the one captured at set() time. The marker is
   * the model view's epoch id (the checkpoint host, else the last /clear), so a
   * checkpoint and /clear invalidate without extra wiring.
   */
  get(rootSessionId: string, boundaryMarker: string): T | undefined
  /** Freeze a snapshot for the session (refreshes recency, evicts beyond the cap). */
  set(rootSessionId: string, boundaryMarker: string, value: T): void
  /** Drop an exact key, or every lane belonging to a deleted session. */
  invalidate(rootSessionId: string): void
  /** Number of retained snapshots (for tests/diagnostics). */
  size(): number
}

interface Entry<T> {
  value: T
  boundaryMarker: string
}

export function createSessionSnapshotCache<T>(
  options: SessionSnapshotCacheOptions = {},
): SessionSnapshotCache<T> {
  const maxEntries = options.maxEntries ?? 200
  const enabled = options.enabled ?? true
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive safe integer')
  }
  const entries = createBoundedCache<string, Entry<T>>({ maxEntries })

  return {
    enabled,
    get(rootSessionId, boundaryMarker) {
      if (!enabled) return undefined
      const entry = entries.get(rootSessionId)
      if (!entry) return undefined
      if (entry.boundaryMarker !== boundaryMarker) {
        // A new view epoch (a checkpoint, or /clear) started — this is a natural
        // prompt-rebuild point, so drop the stale snapshot.
        entries.delete(rootSessionId)
        return undefined
      }
      return entry.value
    },
    set(rootSessionId, boundaryMarker, value) {
      if (!enabled) return
      entries.set(rootSessionId, { value, boundaryMarker })
    },
    invalidate(rootSessionId) {
      entries.delete(rootSessionId)
    },
    size() {
      return entries.size
    },
  }
}
