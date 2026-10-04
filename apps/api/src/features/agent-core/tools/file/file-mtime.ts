import { resolve } from 'node:path'
import { statIfExists } from './file-io'

// ── Stale-file / read-before-write tracking ─────────────────────────────────────
//
// Records the mtime each file had when a tool successfully read or wrote it.
// Two guards read it: `write` refuses to blind-overwrite a file this agent never
// read, and `write`/`apply_patch` refuse to mutate a file whose mtime moved since
// the agent last saw it. Deliberately simple — mtime only, no hashing.
//
// The store is SESSION-SCOPED, not global. A single module-level map made both
// guards leak across concurrent sessions: session A reading a file silently
// unlocked a blind overwrite for session B, and B writing it re-recorded the
// mtime so A's stale check passed over content A had never seen. The chat runtime
// hands each session its own store; a tool built without one gets a private store
// (so tests and one-off callers are isolated by construction).

export interface FileMtimeStore {
  record(path: string, mtimeMs: number): void
  /** Stat the file and record its current mtime (no-op if it doesn't exist). */
  recordNow(path: string): Promise<void>
  clear(path: string): void
  has(path: string): boolean
  /** True when we have a recorded mtime for the path and it differs from `currentMtimeMs`. */
  isStale(path: string, currentMtimeMs: number): boolean
  /**
   * True when this session HAD a record for the path but `invalidateFileMtime`
   * dropped it (the file changed by a route no agent tool observed — the user
   * saving it in the editor, most of all) and no tool has re-read it since.
   * Distinguishes "the user edited it after you read it" from "you never read
   * it" — the two need opposite advice when a patch context fails to match.
   */
  wasInvalidated(path: string): boolean
  /** Drop every record and unregister from `invalidateFileMtime`'s fan-out. */
  dispose(): void
}

// Every live store, so a change made OUTSIDE the agent's tools can invalidate the
// path in all of them at once. A store is unregistered by `dispose()`; a caller
// that never disposes leaks only its own path→mtime entries.
interface StoreState {
  mtimes: Map<string, number>
  /** Paths whose record was dropped by `invalidateFileMtime` and not re-seen since. */
  invalidated: Set<string>
}
const liveStores = new Set<StoreState>()

export function createFileMtimeStore(): FileMtimeStore {
  const state: StoreState = { mtimes: new Map(), invalidated: new Set() }
  const { mtimes, invalidated } = state
  liveStores.add(state)
  return {
    dispose() {
      liveStores.delete(state)
      mtimes.clear()
      invalidated.clear()
    },
    record(path, mtimeMs) {
      const key = resolve(path)
      invalidated.delete(key)
      mtimes.set(key, mtimeMs)
    },
    async recordNow(path) {
      const st = await statIfExists(path)
      if (st) {
        const key = resolve(path)
        invalidated.delete(key)
        mtimes.set(key, st.mtimeMs)
      }
    },
    clear(path) {
      const key = resolve(path)
      mtimes.delete(key)
      invalidated.delete(key)
    },
    has(path) {
      return mtimes.has(resolve(path))
    },
    isStale(path, currentMtimeMs) {
      const recorded = mtimes.get(resolve(path))
      return recorded !== undefined && recorded !== currentMtimeMs
    },
    wasInvalidated(path) {
      return invalidated.has(resolve(path))
    },
  }
}

/**
 * Forget a path in EVERY live store. Call this when the file changed by a route
 * no agent tool observed — the user saving it in the editor, most of all. Dropping
 * the record (rather than re-recording the new mtime) is what keeps the guards
 * honest: no agent has seen the new content, so `write` must refuse the blind
 * overwrite and hand the content back, and `apply_patch` must match against disk.
 */
export function invalidateFileMtime(path: string): void {
  const key = resolve(path)
  for (const state of liveStores) {
    // Flag only stores that actually held a record: a session that never saw the
    // file cannot be told "it changed since you read it".
    if (state.mtimes.delete(key)) state.invalidated.add(key)
  }
}

/** Standard stale-file message shared by write/patch. */
export function staleFileMessage(path: string): string {
  return `${path} changed on disk since you last read it — the user, another process, or your own shell command (sed -i, cat >, tee) edited it. Re-read the file and re-issue your change.`
}
