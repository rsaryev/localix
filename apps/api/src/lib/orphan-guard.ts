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
import { join } from 'node:path'
import { localixHome } from './env'
import {
  pidfileFor,
  readStartToken,
  reapStalePidfiles,
  removePidfile,
  writePidfile,
  type ReapOs,
  type RecordedGroup,
} from './orphan-guard-pidfile'
import { startWatchdog, type Watchdog } from './orphan-guard-watchdog'
import { killProcessTreeNow as killNow } from './process-tree'

/**
 * SIGKILL of the API runs no `exit` handler at all (the Tauri sidecar does it to a hung API, so
 * do dev and test runs), and every tracked child is detached — it would live on under PID 1. So
 * while the guard is installed the tracked set is mirrored to a per-API pidfile, and a watchdog
 * plus the next start reap from it. See orphan-guard-pidfile.ts and orphan-guard-watchdog.ts.
 */
export interface OrphanGuardOptions {
  /** Where the pidfile lives. Default `<localix home>/run`. */
  runDir?: string
  /** Start the per-API watchdog (default: yes, except on Windows). Tests turn it off. */
  watchdog?: boolean
  /** Overrides for stale-pidfile reaping. */
  reapOs?: ReapOs
  /** Reads a process's start time asynchronously; tests inject one. */
  startToken?: (pid: number) => Promise<string | null>
}

interface Persistence {
  file: string
  watchdog: Watchdog | null
  watchdogEnabled: boolean
  tokens: Map<number, string | null>
  startToken: (pid: number) => Promise<string | null>
}

/** Pids of live spawned processes, each the leader of its own group. */
const tracked = new Set<number>()

let persistence: Persistence | undefined

const asyncStartToken = async (pid: number): Promise<string | null> => readStartToken(pid)

function flush(): void {
  if (!persistence) return
  const groups: RecordedGroup[] = [...tracked].map((pid) => ({
    pid,
    token: persistence?.tokens.get(pid) ?? null,
  }))
  writePidfile(persistence.file, groups)
}

function persistTracked(pid: number): void {
  const current = persistence
  if (!current) return
  current.tokens.set(pid, null)
  flush()
  if (current.watchdogEnabled && !current.watchdog) {
    current.watchdog = startWatchdog(process.pid, current.file)
  }
  // The start time lets a later reap tell our group from a recycled pid. Until it arrives the
  // entry is recorded without one, which only matters inside that first few milliseconds.
  void current.startToken(pid).then((token) => {
    if (persistence !== current || !tracked.has(pid) || token === null) return
    current.tokens.set(pid, token)
    flush()
  })
}

/**
 * Register a spawned process for fatal-exit reaping. Returns the untrack disposer — call it
 * when the process settles, so the set stays the LIVE set rather than a session-long log.
 * A missing pid (a spawn that never started) tracks nothing and disposes harmlessly.
 */
export function trackSpawnedProcess(pid: number | undefined | null): () => void {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return () => {}
  tracked.add(pid)
  persistTracked(pid)
  return () => {
    tracked.delete(pid)
    persistence?.tokens.delete(pid)
    flush()
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

export function installOrphanGuard(options: OrphanGuardOptions = {}): () => void {
  if (installed) return installed
  const runDir = options.runDir ?? join(localixHome(), 'run')
  // What an earlier API (and its watchdog, if that died too) left behind.
  reapStalePidfiles(runDir, process.pid, options.reapOs)
  const own: Persistence = {
    file: pidfileFor(runDir, process.pid),
    watchdog: null,
    watchdogEnabled: options.watchdog ?? true,
    tokens: new Map(),
    startToken: options.startToken ?? asyncStartToken,
  }
  persistence = own
  const release = () => {
    own.watchdog?.stop()
    removePidfile(own.file)
    if (persistence === own) persistence = undefined
  }
  const onExit = () => {
    for (const pid of tracked) killNow(pid)
    tracked.clear()
    release()
  }
  process.on('exit', onExit)
  installed = () => {
    process.off('exit', onExit)
    release()
    installed = undefined
  }
  if (tracked.size > 0) for (const pid of tracked) persistTracked(pid)
  return installed
}

/** Reap everything now, without waiting for an exit. Used by tests and by a forced teardown. */
export function reapTrackedProcesses(): void {
  for (const pid of tracked) killNow(pid)
  tracked.clear()
  flush()
}
