/**
 * Coalescing for the workspace file-change signal (`miniAppFiles.watchWorkspace`).
 *
 * The host's watcher already settles a burst for a quarter second, but an agent run, a build or a
 * branch switch is many bursts in a row, and a plugin that re-reads on each one (a `git status`, a
 * re-index) turns the watcher into a process storm. So batches are gathered for a window that
 * starts at the FIRST change and is not pushed back by later ones: steady churn yields one
 * delivery per window instead of starving until the churn stops, which a trailing debounce would
 * do while the person watches a stale panel.
 */
import type { MiniAppWorkspaceChange } from './runtime-payloads'

/** Default window: long enough to fold a save-and-format, short enough to feel live. */
export const DEFAULT_WORKSPACE_CHANGE_WINDOW_MS = 500

/**
 * Past this many distinct paths a batch is delivered coarse (`null`): a consumer would re-read
 * everything anyway, and a list that long only costs memory and comparison time.
 */
export const MAX_COALESCED_PATHS = 512

export interface WorkspaceChangeCoalescer {
  push(paths: readonly string[] | null): void
  close(): void
}

interface Timers {
  set(handler: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createWorkspaceChangeCoalescer(
  sessionId: string,
  deliver: (change: MiniAppWorkspaceChange) => void,
  windowMs: number = DEFAULT_WORKSPACE_CHANGE_WINDOW_MS,
  timers: Timers = realTimers,
): WorkspaceChangeCoalescer {
  let paths = new Set<string>()
  let coarse = false
  let timer: unknown = null
  let closed = false

  const flush = () => {
    timer = null
    if (closed) return
    const change: MiniAppWorkspaceChange = { sessionId, paths: coarse ? null : [...paths] }
    paths = new Set()
    coarse = false
    deliver(change)
  }

  return {
    push(batch) {
      if (closed) return
      if (batch === null) coarse = true
      else if (!coarse) {
        for (const path of batch) paths.add(path)
        if (paths.size > MAX_COALESCED_PATHS) coarse = true
      }
      if (coarse) paths = new Set()
      if (timer === null) timer = timers.set(flush, Math.max(0, windowMs))
    },
    close() {
      closed = true
      if (timer !== null) timers.clear(timer)
      timer = null
    },
  }
}
