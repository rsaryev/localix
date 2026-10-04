import type { SessionStreamRegistry } from '../chat/runtime/session-stream-registry'
import { createDirWatcher, type DirWatcherHandle, type FsChange } from './watcher'

/**
 * Resolve a session's watch root. Returns `null` for a non-local backend (an
 * ssh/docker tree isn't visible to a local `fs.watch`) or when the cwd can't be
 * resolved — either way the session simply has no live watcher and the UI keeps its
 * manual Refresh. Kept agnostic so the chat service owns the session→cwd knowledge.
 */
export type ResolveWatchRoot = (
  userId: string,
  sessionId: string,
) => Promise<{ root: string; local: boolean } | null>

/** The recursive-watcher factory; matches {@link createDirWatcher}. Injectable so the
 *  refcount/eviction/publish logic can be tested with a fake watcher (no real fs). A factory
 *  that does not report entries (`changes` omitted) means "unknown" — the same as `null`. */
export type WatcherFactory = (
  root: string,
  onChange: (absDirs: string[] | null, changes?: FsChange[] | null) => void,
  opts?: { quietMs?: number; onError?: (err: unknown) => void },
) => DirWatcherHandle

export interface FileWatchDeps {
  streamRegistry: SessionStreamRegistry
  resolveRoot: ResolveWatchRoot
  /** Max concurrently-watched roots; the least-recently-armed is evicted past this. */
  maxRoots?: number
  /** Defaults to the real recursive fs watcher; overridden in tests. */
  createWatcher?: WatcherFactory
  /**
   * Called with a watched ROOT whenever its tree changed, before the per-session
   * events go out. Lets a caller drop anything it memoized about that tree (the
   * quick-open file list) on the precise signal rather than a timeout. Kept as a
   * dep so this feature stays agnostic about who caches what.
   *
   * `changes` carries the changed ENTRIES with their create/update/delete type, for a consumer
   * that has to name files rather than reload a view — a language server never heard about a
   * terminal edit, a build or a branch switch, because only the agent's own writes reached it.
   * `null` when they are not known (an overflowing burst, a failed watcher): such a consumer
   * must not read it as "nothing changed".
   */
  onRootChanged?: (root: string, changes: FsChange[] | null) => void
  /** Clock for the failure backoff; overridden in tests. */
  now?: () => number
}

/** One live recursive watcher + the sessions sharing its root. */
interface RootEntry {
  root: string
  handle: DirWatcherHandle
  sessions: Map<string, { userId: string; sessionId: string }>
  /** Monotonic recency stamp; the smallest is evicted first under cap pressure. */
  lastTouch: number
}

const DEFAULT_MAX_ROOTS = 48
/** Backoff after a watcher failure: 1s, 2s, 4s … capped — see `arm`. */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000

/**
 * Lazily armed filesystem-change broadcaster for the workspace file tree. ONE
 * recursive watcher per canonical cwd, reference-counted by the sessions that share
 * it (so an owner and a reviewer/worker in the same directory cost a single
 * inotify handle). On a debounced change it publishes a `fs.changed` event per
 * sharing session; the UI invalidates exactly the listed directories.
 *
 * Bounded by an LRU cap on watched roots (a long-lived server never accumulates
 * watchers without limit) and by per-session `release()` on delete. Local-only — see
 * {@link ResolveWatchRoot}.
 */
export function createFileWatchService(deps: FileWatchDeps) {
  const maxRoots = deps.maxRoots ?? DEFAULT_MAX_ROOTS
  const makeWatcher = deps.createWatcher ?? createDirWatcher
  const byRoot = new Map<string, RootEntry>()
  // sessionId -> the root it is registered under (for release()).
  const sessionRoot = new Map<string, string>()
  // root -> consecutive failures and when the next attempt is allowed (see `arm`).
  const failures = new Map<string, { count: number; retryAt: number }>()
  const now = deps.now ?? Date.now
  let clock = 0
  const tick = () => ++clock
  const keyOf = (userId: string, sessionId: string) => `${userId}:${sessionId}`

  const publishChange = (entry: RootEntry, dirs: string[] | null, changes: FsChange[] | null) => {
    deps.onRootChanged?.(entry.root, changes)
    for (const { userId, sessionId } of entry.sessions.values()) {
      deps.streamRegistry.publish(userId, sessionId, {
        type: 'fs.changed',
        sessionId,
        // Empty array IS the wire form of a coarse "reload everything visible" signal.
        paths: dirs ?? [],
      })
    }
  }

  /**
   * Remove a session from one root's set, closing that root's watcher when it was the
   * last one. Shared by `release` and by `arm`'s re-bind below — a session that MOVES
   * must leave the root it came from, which is the whole reason this is a function and
   * not inline in `release`.
   */
  const detach = (root: string, sessionId: string) => {
    const entry = byRoot.get(root)
    if (!entry) return
    for (const [key, s] of entry.sessions) if (s.sessionId === sessionId) entry.sessions.delete(key)
    if (entry.sessions.size === 0) dropRoot(root)
  }

  const dropRoot = (root: string) => {
    const entry = byRoot.get(root)
    if (!entry) return
    entry.handle.close()
    for (const { sessionId } of entry.sessions.values()) {
      if (sessionRoot.get(sessionId) === root) sessionRoot.delete(sessionId)
    }
    byRoot.delete(root)
  }

  const evictIfNeeded = () => {
    while (byRoot.size > maxRoots) {
      let oldest: RootEntry | null = null
      for (const e of byRoot.values()) if (!oldest || e.lastTouch < oldest.lastTouch) oldest = e
      if (!oldest) break
      dropRoot(oldest.root)
    }
  }

  /**
   * A watcher that failed after it was live (the backend's runtime error, a root that went away)
   * may have missed changes, and the sessions on it would otherwise keep showing that stale tree
   * with nothing left to correct it. So the sessions get ONE coarse "reload what you have open"
   * signal — the client re-lists, and a listing re-arms (`arm`, subject to the backoff below).
   */
  const failRoot = (root: string) => {
    const previous = failures.get(root)?.count ?? 0
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** previous)
    failures.set(root, { count: previous + 1, retryAt: now() + delay })
    const entry = byRoot.get(root)
    if (!entry) return
    publishChange(entry, null, null)
    dropRoot(root)
  }

  return {
    /**
     * Arm a live recursive watcher for a session's cwd (idempotent) and answer whether the
     * session's tree is LIVE — the UI offers a manual Refresh only when it is not. Called on
     * every listing: re-arming bumps recency, attaches the session to a shared root, and is how
     * a watcher lost to a server restart, LRU eviction or a failure comes back without anyone
     * pressing Refresh. `false` for a non-local session, and while a failed root waits out its
     * backoff (a persistent failure such as inotify ENOSPC must not turn every listing into a
     * new failing watcher).
     */
    async arm(userId: string, sessionId: string): Promise<boolean> {
      let resolved: { root: string; local: boolean } | null
      try {
        resolved = await deps.resolveRoot(userId, sessionId)
      } catch {
        return false
      }
      if (!resolved || !resolved.local) return false
      const { root } = resolved

      // A session's root is NOT fixed — it moves when the session's project does, and
      // `arm` re-runs on every tree listing.
      // Re-binding used to add the session to the NEW root and overwrite `sessionRoot`
      // while leaving it in the OLD root's set, which nothing could then remove:
      // `release` only ever looks at the CURRENT binding. Two consequences, and the
      // second is the one users feel: the abandoned root never reached zero sessions,
      // so its watcher lived on until LRU eviction — and it kept publishing
      // `fs.changed` to this session, so edits in the directory the session had LEFT
      // reloaded its tree. (`dropRoot` already guards `sessionRoot.get(id) === root`
      // for exactly this reason; the move itself just never detached.)

      const previous = sessionRoot.get(sessionId)
      if (previous && previous !== root) detach(previous, sessionId)

      const existing = byRoot.get(root)
      if (existing) {
        existing.sessions.set(keyOf(userId, sessionId), { userId, sessionId })
        existing.lastTouch = tick()
        sessionRoot.set(sessionId, root)
        return true
      }

      const failed = failures.get(root)
      if (failed && now() < failed.retryAt) return false

      // A factory may report failure synchronously (no addon for this platform) — before the
      // entry below exists. Registering it anyway would leave a dead watcher that every later
      // `arm` takes for a live one, so the root would never be retried.
      let failedDuringCreate = false
      let handle: DirWatcherHandle
      try {
        handle = makeWatcher(
          root,
          (dirs, changes) => {
            failures.delete(root) // it delivered: the backend is healthy again
            const entry = byRoot.get(root)
            if (entry) publishChange(entry, dirs, changes ?? null)
          },
          {
            onError: () => {
              if (byRoot.has(root)) failRoot(root)
              else failedDuringCreate = true
            },
          },
        )
      } catch {
        failedDuringCreate = true
        handle = { close() {} }
      }
      if (failedDuringCreate) {
        handle.close()
        failRoot(root)
        return false
      }
      byRoot.set(root, {
        root,
        handle,
        sessions: new Map([[keyOf(userId, sessionId), { userId, sessionId }]]),
        lastTouch: tick(),
      })
      sessionRoot.set(sessionId, root)
      evictIfNeeded()
      return true
    },

    /**
     * Detach a session (e.g. it was deleted); closes the watcher when its last
     * session leaves. Safe to call for an unwatched session.
     */
    release(sessionId: string): void {
      const root = sessionRoot.get(sessionId)
      if (!root) return
      sessionRoot.delete(sessionId)
      detach(root, sessionId)
    },

    /** Close every watcher (server shutdown / test teardown). */
    closeAll(): void {
      for (const root of byRoot.keys()) dropRoot(root)
    },

    /** Number of live root watchers (tests/observability). */
    size(): number {
      return byRoot.size
    },
  }
}
