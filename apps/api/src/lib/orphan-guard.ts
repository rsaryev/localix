/**
 * The last-resort reaper for processes we spawned.
 *
 * Graceful shutdown already kills them (see `startServer`'s cleanup chain: PTYs, LSP
 * children, subsystem hooks). That path is necessary and insufficient: it is `async`, and
 * Node does not await async work on a FATAL exit — an uncaught exception, an explicit
 * `process.exit`, a failed startup. Our children are spawned `detached` into their own
 * process groups precisely so a signal to us does not reach them, so on that path they are
 * not merely un-killed, they are ORPHANED: a `npm run dev` server or a PTY shell that
 * outlives the app with nothing left to stop it.
 *
 * So this is the synchronous half. `process.on('exit')` runs synchronously and may not
 * await anything, which dictates the whole design:
 *
 *   - SIGKILL immediately. No SIGTERM-then-grace ladder — a grace period needs a timer,
 *     and no timer will ever fire.
 *   - Failures are contained PER TARGET. One dead pid (already exited, reused, not ours)
 *     must not stop the rest from being reaped.
 *   - The registry holds pids, not handles. An exit handler must not touch a subsystem
 *     that may itself be half torn down.
 */

// The synchronous group SIGKILL (no timer, no spawn) — exactly what an exit handler may do.
import { killProcessTreeNow as killNow } from './process-tree'

/** Pids of live spawned processes, each the leader of its own group. */
const tracked = new Set<number>()

/**
 * Register a spawned process for fatal-exit reaping. Returns the untrack disposer — call it
 * when the process settles, so the set stays the LIVE set rather than a session-long log.
 * A missing pid (a spawn that never started) tracks nothing and disposes harmlessly.
 */
export function trackSpawnedProcess(pid: number | undefined | null): () => void {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return () => {}
  tracked.add(pid)
  return () => {
    tracked.delete(pid)
  }
}

/** How many processes would be reaped right now. Diagnostics and tests only. */
export function trackedProcessCount(): number {
  return tracked.size
}

/**
 * Install the fatal-exit reaper. Returns a disposer so the graceful path can remove it once
 * it has killed everything properly — leaving it installed would be harmless (the set is
 * empty by then) but keeping lifecycle symmetric is what makes that easy to verify.
 *
 * Idempotent: a second install replaces nothing and adds no second handler.
 */
let installed: (() => void) | undefined

export function installOrphanGuard(): () => void {
  if (installed) return installed
  const onExit = () => {
    for (const pid of tracked) killNow(pid)
    tracked.clear()
  }
  process.on('exit', onExit)
  installed = () => {
    process.off('exit', onExit)
    installed = undefined
  }
  return installed
}

/** Reap everything now, without waiting for an exit. Used by tests and by a forced teardown. */
export function reapTrackedProcesses(): void {
  for (const pid of tracked) killNow(pid)
  tracked.clear()
}
