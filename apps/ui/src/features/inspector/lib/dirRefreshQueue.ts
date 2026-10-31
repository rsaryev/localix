/**
 * Fan-out guard for the file tree's live refresh. The fs-watch feed hands the tree
 * a set of changed directories — or, on large churn, a COARSE frame meaning "reload
 * everything you have open". The tree's reaction is one `listDirectory` RPC per
 * loaded directory, and each of those spawns a shell `ls` on the server. Firing
 * them all at once means the churn that produced the coarse frame (a branch switch,
 * an install, a build) is answered with one shell spawn per expanded folder — the
 * client's work grows with how much tree the user happened to expand, which nothing
 * bounds. The server already caps its side at 64 directories per frame; this is the
 * matching cap on ours.
 *
 * Two bounds: a short window COALESCES a burst of frames into a single pass, and
 * a limiter caps how many directory reads are in flight at once. Directories requested while a pass is
 * running join the next one, deduped — so a sustained churn degrades into a steady
 * trickle of refreshes instead of a stampede.
 */

type TimerHandle = ReturnType<typeof setTimeout>

export interface DirRefreshQueueDeps {
  /** Coalesce window (ms). Short: the server's watcher already debounces at 250ms,
   *  and the tree should still feel live. */
  delayMs?: number
  /** Max directory reads in flight at once. */
  concurrency?: number
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
}

export interface DirRefreshQueue {
  /** Queue directories for refresh; a burst inside the window becomes one pass. */
  request(dirs: Iterable<string>): void
  /** Drop everything pending (session switch / unmount). In-flight reads still
   *  settle — their results are dropped by the caller's own read tokens. */
  reset(): void
}

const DEFAULT_DIR_REFRESH_DELAY_MS = 80
const DEFAULT_DIR_REFRESH_CONCURRENCY = 6

export function createDirRefreshQueue(
  run: (dir: string) => Promise<unknown>,
  deps: DirRefreshQueueDeps = {},
): DirRefreshQueue {
  const delayMs = deps.delayMs ?? DEFAULT_DIR_REFRESH_DELAY_MS
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_DIR_REFRESH_CONCURRENCY)
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h))

  const pending = new Set<string>()
  let timer: TimerHandle | null = null
  let active = 0

  const pump = () => {
    while (active < concurrency) {
      const next = pending.values().next()
      if (next.done) return
      pending.delete(next.value)
      active++
      void Promise.resolve(run(next.value))
        .catch(() => {
          /* the caller leaves the directory stale; a later frame retries */
        })
        .finally(() => {
          active--
          pump()
        })
    }
  }

  return {
    request(dirs) {
      let added = false
      for (const dir of dirs) {
        if (dir) {
          pending.add(dir)
          added = true
        }
      }
      if (!added || timer !== null) return
      timer = setTimer(() => {
        timer = null
        pump()
      }, delayMs)
    },

    reset() {
      pending.clear()
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
    },
  }
}
