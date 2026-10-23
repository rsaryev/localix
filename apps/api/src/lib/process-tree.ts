/**
 * The one way this host kills a process TREE.
 *
 * The same ladder was written four times — the bash job/LSP/skill-command killer, the PTY
 * backend, the login-shell probe's timeout and the fatal-exit orphan reaper — so a fix to one
 * (the pid-reuse guard on escalation, the Windows tree kill) reached only that one. Every
 * caller now picks one of two entry points:
 *
 *   killProcessTree     graceful: SIGTERM the group (taskkill /T on Windows), SIGKILL
 *                       (taskkill /F /T) after a grace period — asked first whether the target
 *                       is still the process we started, so the escalation cannot land on a pid
 *                       the OS handed to someone else in the meantime.
 *   killProcessTreeNow  synchronous SIGKILL of the group, then the pid — for a timeout that has
 *                       already given up, and for `process.on('exit')`, where no timer fires.
 *
 * Both reach the GROUP (`-pid`): our children are spawned as group leaders so a signal to us
 * does not reach them, which means a signal to only the leader would orphan its children.
 * Not reached: a descendant that called `setsid` has left the group. Finding it needs the
 * process table read BEFORE the root dies (after, it is reparented and its ancestry is gone),
 * which would put a `ps` round trip in front of every kill; that trade is not taken here.
 */
import { spawn } from 'node:child_process'

const DEFAULT_KILL_GRACE_MS = 3_000

/** Whether a process (or, with a negative pid, a process group) is alive — signal 0 probes. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * "Still ours", asked of the handle rather than of the pid.
 *
 * Only a positively known exit suppresses the kill. A handle that reports nothing — an
 * unexpected shape, a stub — is treated as still running, because the two mistakes are not
 * symmetric: refusing to kill leaks a process we started, while killing a pid the OS has
 * already handed to someone else reaches into a stranger's process.
 */
export function stillRunning(
  child: { exitCode?: number | null } | null | undefined,
): () => boolean {
  return () => (child?.exitCode ?? null) === null
}

const validPid = (pid: number | undefined | null): pid is number =>
  !!pid && Number.isFinite(pid) && pid > 0

/**
 * Kill the process tree rooted at `pid` (SIGTERM, then SIGKILL after `graceMs`). No-op for a
 * missing/invalid pid. Extensions that start processes use their SDK helpers instead.
 *
 * `stillRunning` answers, at ESCALATION time, whether the process about to be SIGKILLed is
 * still the one we started. A pid cannot answer that: the target may exit during the grace
 * window and the OS may hand its number to something else — on macOS the pid space is small
 * enough for that to be reachable. Omitting it keeps the pid-derived behaviour, which is the
 * best an unverified caller can do.
 */
/** What the escalation needs from the OS; tests pass their own to decide it without processes. */
export interface ProcessSignals {
  platform: NodeJS.Platform
  kill: (pid: number, signal: NodeJS.Signals) => void
  isAlive: (pid: number) => boolean
  afterGrace: (run: () => void, graceMs: number) => void
  /** Windows: `taskkill /T` for the tree, `/F` to force it. */
  taskkill: (pid: number, force: boolean) => void
}

const REAL_SIGNALS: ProcessSignals = {
  platform: process.platform,
  kill: (pid, signal) => process.kill(pid, signal),
  isAlive,
  afterGrace: (run, graceMs) => setTimeout(run, graceMs).unref(),
  taskkill: (pid, force) => {
    try {
      spawn('taskkill', [...(force ? ['/F'] : []), '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      })
    } catch {
      /* ignore */
    }
  },
}

export function killProcessTree(
  pid: number | undefined,
  graceMs = DEFAULT_KILL_GRACE_MS,
  stillRunning?: () => boolean,
  os: ProcessSignals = REAL_SIGNALS,
): void {
  if (!validPid(pid)) return

  if (os.platform === 'win32') {
    os.taskkill(pid, false)
    os.afterGrace(() => {
      if (stillRunning?.() === false) return
      if (os.isAlive(pid)) os.taskkill(pid, true)
    }, graceMs)
    return
  }

  // Unix: kill the process group (negative pid), falling back to the pid.
  try {
    os.kill(-pid, 'SIGTERM')
  } catch {
    try {
      os.kill(pid, 'SIGTERM')
    } catch {
      return
    }
  }
  os.afterGrace(() => {
    // Asked before either kill form: the group number is derived from the same pid, so a
    // recycled pid that became its own group leader would make the group check agree too.
    if (stillRunning?.() === false) return
    if (os.isAlive(-pid)) {
      try {
        os.kill(-pid, 'SIGKILL')
        return
      } catch {
        /* fall through */
      }
    }
    if (!os.isAlive(pid)) return
    try {
      os.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }, graceMs)
}

/**
 * SIGKILL a process group, synchronously, swallowing every failure.
 *
 * The group form (`-pid`) is what reaches the shell's own children. It fails on Windows (no
 * process groups) and when the leader is already gone, so the bare pid is tried after it.
 * Safe in an exit handler: no timer, no spawn, nothing that has to come back.
 */
export function killProcessTreeNow(pid: number | undefined | null): void {
  if (!validPid(pid)) return
  try {
    process.kill(-pid, 'SIGKILL')
    return
  } catch {
    /* no group, or already gone — try the pid itself */
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already exited, reused, or not ours: nothing to do and nothing to report */
  }
}
