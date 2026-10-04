import { spawn, type ChildProcess } from 'node:child_process'

import { awaitChildGone, releaseChildPipes } from '../../../../lib/child-exit'
import { killProcessTree, stillRunning } from '../bash/process-tree'
import { createStreamTextDecoder } from '../../../../lib/stream-text'

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
  /**
   * Present ONLY for an `onTimeout: 'detach'` deadline: the command outran its
   * budget and is still running, handed to the caller instead of killed.
   * `exitCode` is -1 and carries no verdict — the process has not exited.
   *
   * Ownership transfers with this object: spawn's own timeout, abort listener and
   * data listeners are gone, so nothing here will be killed or drained on our
   * behalf. The receiver MUST adopt it (see `adoptChildBgProc`) or kill it.
   */
  detached?: DetachedChild
}

/** A live child handed over at its timeout deadline, with everything read so far. */
export interface DetachedChild {
  child: ChildProcess
  /** Output captured before the handover. The adopter seeds its buffer with this. */
  stdout: string
  stderr: string
}

export interface SpawnOptions {
  cwd?: string
  timeout?: number
  stdinContent?: string
  signal?: AbortSignal
  /**
   * Skip the output tail cap and keep the COMPLETE stdout. Used for full-file
   * reads (`cat`) over ssh/docker — capping would silently truncate a large file
   * to its last 2MB, unlike the local backend's node-fs read.
   */
  uncapped?: boolean
  /**
   * Environment for the child. Defaults to the parent's start-of-process env.
   * The LOCAL backend passes `childEnv()` here so a command gets the user's real
   * login-shell env (repaired PATH + stack vars) even under a bare GUI launch —
   * REQUIRED under Bun, where a no-`env` spawn only sees the process-start
   * snapshot and never later `process.env` mutations (see lib/login-shell-env.ts).
   */
  env?: NodeJS.ProcessEnv
  /**
   * What a `timeout` deadline does to the child. `'kill'` (the default) reaps the
   * process tree and reports exit 124 — the only behaviour before this option, and
   * the one every remote/uncapped caller keeps.
   *
   * `'detach'` hands the still-running child back instead (see {@link DetachedChild}),
   * for callers that can promote a slow foreground command to a background job
   * rather than destroying work that was merely slower than its budget.
   */
  onTimeout?: 'kill' | 'detach'
}

/**
 * Spawn a child process and resolve with its captured output. The single
 * implementation shared by the local AND ssh/docker execution backends, so the
 * capture-cap, abort/timeout handling, and the orphaned-pipe grace window have
 * ONE source of truth. (A divergent per-backend copy is exactly how the remote
 * backends silently dropped the AbortSignal contract before this was unified.)
 */
export function spawnToResult(
  cmd: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own a process group so timeout/abort can reap shell descendants too.
      // Without this, killing the shell PID leaves `command &` children alive.
      detached: process.platform !== 'win32',
      windowsHide: true,
    })

    // Bound capture memory: a fast high-volume command (`yes`, `cat /dev/zero |
    // base64`, a runaway log) could otherwise accumulate gigabytes here before the
    // timeout fires and OOM the server. Consumers only ever surface the last
    // ~100KB, so keep a generous tail and trim past a hard cap (amortized — the
    // slice runs at most once per CAPTURE_CAP of data). EXCEPTION: uncapped reads
    // (full-file `cat`) must return complete content, so they skip the cap.
    const CAPTURE_CAP = 2_000_000
    // One decoder per STREAM: `chunk.toString()` decodes each read in isolation, so
    // a multi-byte character straddling two reads became U+FFFD on both sides —
    // silently, in ripgrep matches, bash output and any non-ASCII path.
    const decodeOut = createStreamTextDecoder()
    const decodeErr = createStreamTextDecoder()
    const append = (buf: string, chunk: string): string => {
      const next = buf + chunk
      if (opts.uncapped) return next
      return next.length > CAPTURE_CAP * 2 ? next.slice(-CAPTURE_CAP) : next
    }
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, decodeOut(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, decodeErr(chunk))
    })

    if (opts.stdinContent !== undefined) {
      child.stdin?.write(opts.stdinContent)
      child.stdin?.end()
    } else {
      child.stdin?.end()
    }

    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      opts.signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      // Clear the pending timeout so its closure (and the child reference it pins)
      // can be collected immediately rather than lingering for up to `timeout`s.
      if (timeoutHandle) clearTimeout(timeoutHandle)
      killProcessTree(child.pid, 0, stillRunning(child))
      resolve({ stdout, stderr: stderr + '\n[Aborted]', exitCode: 130 })
    }

    if (opts.signal?.aborted) {
      abort()
      return
    }
    opts.signal?.addEventListener('abort', abort, { once: true })

    if (opts.timeout) {
      timeoutHandle = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        if (opts.onTimeout !== 'detach') {
          killProcessTree(child.pid, 0, stillRunning(child))
          resolve({
            stdout,
            stderr: stderr + `\n[Timed out after ${opts.timeout}s]`,
            exitCode: 124,
          })
          return
        }
        // HANDOVER, not a result. `settled` already blocks the exit path from
        // resolving a second time, and `cleanup()` dropped the abort listener —
        // the run's cancellation no longer reaches this child, because the job
        // that adopts it owns its kill from here.
        //
        // Pausing before dropping our data listeners is what makes the handover
        // lossless: removing a 'data' listener does NOT stop a flowing stream, so
        // bytes arriving in the microtask gap before the adopter subscribes would
        // be dropped on the floor. Paused, they queue in the stream's own buffer
        // and replay to whoever resumes it.
        child.stdout?.pause()
        child.stderr?.pause()
        child.stdout?.removeAllListeners('data')
        child.stderr?.removeAllListeners('data')
        resolve({ stdout, stderr, exitCode: -1, detached: { child, stdout, stderr } })
      }, opts.timeout * 1000)
    }

    // "When is the child actually gone?" is `lib/child-exit.ts`'s question, not
    // ours: `'close'` (all stdio EOF) is preferred but a command that backgrounds a
    // child (`... &`, setsid, a build daemon) leaves it holding our inherited stdout
    // pipe, so `'close'` never fires and the call would stall until the timeout —
    // hence the bounded drain after `'exit'`. This file used to re-implement that
    // rule, drain constant and all; it now asks the owner.
    void awaitChildGone(child).then(({ code, error, viaExit }) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        resolve({ stdout, stderr: stderr + `\n${error.message}`, exitCode: -1 })
        return
      }
      // Settled on `'exit'` + drain: something the command left behind still holds
      // the pipes. Stop feeding a wait that is already over (the survivor keeps
      // writing into these closures otherwise), but keep draining so we never EPIPE
      // the dev server the agent was asked to leave running.
      if (viaExit) releaseChildPipes(child)
      resolve({
        stdout,
        stderr:
          stderr +
          (viaExit
            ? '\n[note: a backgrounded child kept output open; returned on shell exit]'
            : ''),
        exitCode: code ?? -1,
      })
    })
  })
}
