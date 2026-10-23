/**
 * "When is a child process actually gone?" — the one answer, for every caller
 * that spawns one.
 *
 * The naive answer is `'close'`, and it is wrong. `'close'` fires only once
 * EVERY inherited stdio descriptor is closed, and the child is not the only one
 * holding them: anything it spawned inherited them too. A command that leaves a
 * daemon behind (`foo &`, `setsid`, a build/tool daemon like turbo/gradle, an
 * `ssh -f`) exits immediately while that daemon keeps our stdout pipe open — for
 * seconds, or for as long as it lives. A caller waiting on `'close'` is then
 * hostage to a process it never asked for, and cannot even kill: a daemon that
 * called `setsid` has left our process group, so `kill(-pid)` never reaches it.
 *
 * The consequence is worse than a slow wait. A timeout that kills the child
 * bounds the PROCESS, not the WAIT — the promise still never settles, so the
 * caller's own deadline is silently defeated by the thing it just killed.
 *
 * So: `'close'` stays PREFERRED — it means the output is fully drained, and in
 * the normal case (nobody else holds the pipes) it arrives immediately after
 * exit, so nothing is truncated. But `'exit'` — the child itself is gone — ends
 * the wait after a bounded drain window. Whichever comes first wins.
 *
 * Release It!: explicit, intentional limits on waits we do not control.
 */
import type { ChildProcess } from 'node:child_process'

/**
 * How long we keep reading a dead child's pipes before taking what we have. The
 * child is gone, so everything IT wrote is already in the pipe and is delivered
 * well inside this window. We only ever spend it when someone ELSE still holds
 * the write end.
 */
export const EXIT_DRAIN_MS = 250

export interface ChildGone {
  /** Exit code, or null on a spawn/IO error (or a signal kill). */
  code: number | null
  /** Set when the child never spawned / errored out. */
  error?: Error
  /**
   * True when the wait ended on `'exit'` + drain rather than on `'close'` — i.e.
   * something the command left behind still holds the stdio pipes. Diagnostic:
   * callers may note it, and should stop reading (or drain to nowhere) after.
   */
  viaExit: boolean
}

/**
 * Resolve once the CHILD PROCESS is gone — never held hostage by a pipe someone
 * else still holds. See the module comment for why `'close'` alone is a trap.
 *
 * Never rejects. The drain timer is `unref`'d, so a lingering pipe-holder can
 * never keep the process alive at shutdown.
 */
export function awaitChildGone(
  child: ChildProcess,
  opts: {
    drainMs?: number
    /**
     * Fired the moment the child exits — BEFORE the drain window. Clear any
     * kill/run cap here: the process is gone, so there is nothing left to kill,
     * and a cap that fires during the drain would relabel a run that finished in
     * time as a timeout (and signal a pid that is no longer ours).
     */
    onExit?: () => void
  } = {},
): Promise<ChildGone> {
  const drainMs = opts.drainMs ?? EXIT_DRAIN_MS
  return new Promise<ChildGone>((resolve) => {
    let done = false
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    const onClose = (code: number | null) => settle({ code, viaExit: false })
    const onExit = (code: number | null) => {
      if (done) return
      opts.onExit?.()
      // `onExit` is allowed to synchronously trigger another terminal event.
      // Do not leave a drain timer behind when that event already settled us.
      if (done) return
      drainTimer = setTimeout(() => settle({ code, viaExit: true }), drainMs)
      drainTimer.unref?.()
    }
    const onError = (error: Error) => settle({ code: null, error, viaExit: false })
    const cleanup = () => {
      clearTimeout(drainTimer)
      child.removeListener('close', onClose)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
    }
    const settle = (result: ChildGone) => {
      if (done) return
      done = true
      cleanup()
      resolve(result)
    }
    child.once('close', onClose)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

/**
 * A `Bun.spawn` child, as much of it as a teardown needs. Deliberately STRUCTURAL: the
 * callers are the bundled workbench plugins (kubernetes port-forwards + pod watches, and
 * anything that follows), whose own tests inject a fake, so it must not demand a real
 * `Subprocess`.
 */
export interface BunChild {
  /** Resolves with the exit code once the child is reaped. */
  readonly exited: Promise<number>
  kill(signal?: NodeJS.Signals | number): void
}

/** How long a SIGTERM'd child has to exit on its own before it is SIGKILL'd. */
export const KILL_ESCALATION_MS = 2_000

/**
 * Kill a `Bun.spawn` child and WAIT until it is actually gone — with the SIGTERM → wait →
 * SIGKILL escalation INSIDE, because that is the part every hand-rolled copy gets subtly
 * different.
 *
 * `awaitChildGone` above cannot serve these callers: it is `ChildProcess`-shaped (`.once()`),
 * and a Bun subprocess has no event emitter — it has `.exited`. So both workbench backends
 * grew their own teardown, and neither actually waits: `proc.kill()` returns immediately, the
 * registry entry is deleted, and the caller believes the port is free / the watch is torn
 * down while the child is still shutting down. Two symptoms, both real: a restart races the
 * corpse for the local port, and a process that IGNORES SIGTERM (a `kubectl` wedged on a
 * dead API server) is never escalated to SIGKILL — it survives shutdown entirely.
 *
 * THE ESCALATION IS THE WHOLE POINT, and it is what a copy gets wrong:
 *   - send the polite signal FIRST (a SIGKILL'd child cannot flush, close its sockets, or
 *     tell the far end it is going away);
 *   - give it a BOUNDED grace — unbounded means "wait forever for a process that decided not
 *     to die", which is how a shutdown hook hangs a server;
 *   - then SIGKILL, and keep waiting: the second signal is not the end of the wait, the exit is.
 *
 * Never rejects, never throws: a child that is already reaped makes `kill()` throw ESRCH on
 * some platforms, and that is a SUCCESS, not an error. The escalation timer is `unref`'d so a
 * lingering child can never keep the process alive at shutdown.
 *
 * @returns `true` if the child exited within the grace window (polite signal was enough),
 *          `false` if it had to be escalated. Diagnostic: a caller may log it; nobody must
 *          branch on it for correctness, because either way the child IS gone on resolve.
 *
 * Release It!: an explicit, intentional limit on a wait we do not control.
 */
export async function awaitBunChildGone(
  proc: BunChild,
  opts: { signal?: 'SIGTERM' | 'SIGKILL'; timeoutMs?: number } = {},
): Promise<boolean> {
  const signal = opts.signal ?? 'SIGTERM'
  const timeoutMs = opts.timeoutMs ?? KILL_ESCALATION_MS

  // A child already gone: `kill` may throw ESRCH. Swallow — the postcondition already holds.
  try {
    proc.kill(signal)
  } catch {
    /* already reaped */
  }

  // SIGKILL is terminal: there is nothing to escalate TO, so just wait it out.
  if (signal === 'SIGKILL') {
    await proc.exited.catch(() => undefined)
    return true
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const graceExpired = new Promise<'escalate'>((resolve) => {
    timer = setTimeout(() => resolve('escalate'), timeoutMs)
    timer.unref?.()
  })
  const exited = proc.exited.catch(() => undefined).then(() => 'exited' as const)

  try {
    if ((await Promise.race([exited, graceExpired])) === 'exited') return true
  } finally {
    clearTimeout(timer)
  }

  // It ignored the polite signal. Escalate, and keep waiting — the SECOND signal is not the
  // end of the wait; the exit is. (A copy that returns here is exactly the bug: it reports
  // the child gone while it is still being killed.)
  try {
    proc.kill('SIGKILL')
  } catch {
    /* raced us to the grave */
  }
  await exited
  return false
}

/**
 * Let go of a gone child's pipes: stop feeding a finished wait, but keep READING
 * and discarding whatever still comes out.
 *
 * Call it after an `viaExit` settle, when something the command left behind still
 * holds the write end. We do NOT destroy the read end: closing it would EPIPE the
 * survivor — which may be exactly the dev server the agent was asked to leave
 * running. Draining to nowhere neither blocks that writer (a full pipe buffer
 * would) nor kills it, and costs no memory.
 *
 * There is NO caller for whom `destroy()` is the right ending, and the runtimes
 * will not warn you if you reach for it: on Node it closes the fd and the survivor
 * dies of SIGPIPE on its next log line; on Bun (what we ship) it does not close the
 * fd at all, so it does not even release the handle it was reached for — it is
 * lethal on one runtime and pointless on the other. This function is the ending.
 */
export function releaseChildPipes(child: ChildProcess): void {
  for (const pipe of [child.stdout, child.stderr]) {
    if (!pipe) continue
    pipe.removeAllListeners('data')
    pipe.resume()
  }
}
