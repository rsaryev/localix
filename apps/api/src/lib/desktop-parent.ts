import { fstatSync, type Stats } from 'node:fs'

/**
 * Noticing that the desktop shell which owns this runtime is gone.
 *
 * The shell spawns the runtime with a PIPE on stdin — the same pipe it writes `shutdown\n`
 * to on quit. When the shell dies without saying so (a crash, a force quit, a killed
 * process tree) the kernel closes its end, and our stdin reads end-of-file at once. That is
 * the one signal immune to PID reuse: the 1 s `kill(pid, 0)` watchdog asks whether SOME
 * process holds the parent's old pid, and on Windows — which recycles pids aggressively —
 * an unrelated process soon does, so an orphaned runtime could live on holding the lease,
 * the port and every child it started.
 *
 * Armed only when stdin really is a pipe from a desktop parent. A TTY never ends; `/dev/null`
 * (or `NUL`) and a redirected file read end-of-file immediately, and treating that as a dead
 * parent would stop a runtime the moment it started.
 */

export interface ParentStdinFacts {
  /** `LOCALIX_DESKTOP_PARENT_PID` — set only by the desktop shell. */
  parentPid: number | undefined
  isTTY: boolean
  /** `fstat(0)`, or undefined when stdin is closed or cannot be inspected. */
  stat: Pick<Stats, 'isCharacterDevice' | 'isFile'> | undefined
}

/** Is stdin the desktop shell's pipe — the stream whose end means the shell is gone? */
export function stdinIsParentPipe(facts: ParentStdinFacts): boolean {
  if (!facts.parentPid || facts.isTTY || !facts.stat) return false
  return !facts.stat.isCharacterDevice() && !facts.stat.isFile()
}

/** The facts about THIS process's stdin. */
export function currentStdinFacts(parentPid: number | undefined): ParentStdinFacts {
  let stat: ParentStdinFacts['stat']
  try {
    stat = fstatSync(0)
  } catch {
    stat = undefined
  }
  // Typed boolean, but a non-TTY stdin leaves it undefined at runtime.
  return { parentPid, isTTY: Boolean(process.stdin.isTTY), stat }
}

/**
 * Call `onGone` once, when the parent's end of the pipe closes. `end` is the normal EOF;
 * `close` and `error` cover a pipe torn down without one (Windows reports a broken pipe).
 */
export function watchParentStdin(
  stream: { once(event: string, listener: () => void): unknown; resume(): unknown },
  onGone: () => void,
): void {
  let fired = false
  const fire = () => {
    if (fired) return
    fired = true
    onGone()
  }
  stream.once('end', fire)
  stream.once('close', fire)
  stream.once('error', fire)
  // EOF is only observed by a stream that is flowing.
  stream.resume()
}
