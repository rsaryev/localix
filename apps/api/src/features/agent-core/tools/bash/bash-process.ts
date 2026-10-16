import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import { resolveShellConfig } from '../environments/shell'
import { awaitChildGone, releaseChildPipes } from '../../../../lib/child-exit'
import { childEnvNonInteractive } from '../../../../lib/login-shell-env'
import { killProcessTree, stillRunning } from './process-tree'
import { trackSpawnedProcess } from '../../../../lib/orphan-guard'
import type { SpawnTerminalJob, TerminalJobHandle } from '../terminal/terminal-job'
import { createStreamTextDecoder } from '../../../../lib/stream-text'

export interface BackgroundInputPayload {
  text?: string
}

/**
 * Unified background process — the job lifecycle (output capture, kill, input,
 * completion, notify) is written against this so it works identically whether
 * the job runs in a PTY pane (`spawnTerminalJob`) or a detached child process.
 */
export interface BgProc {
  onOutput(listener: (chunk: string) => void): void
  write(text: string): void
  /** Stop the job on purpose; `reason` (`timeout 60 s`) is told to the person where it shows. */
  kill(reason?: string): void
  /** Resolves with the exit code (null on spawn/IO error). Cached — safe to await repeatedly. */
  exited: Promise<number | null>
  /** Backend terminal id when the job runs in a PTY pane; absent for child_process jobs. */
  terminalId?: string
  /** Notify when the job advertises a dev-server URL (PTY jobs only — the host
   *  detects it from output). Absent for child_process jobs. */
  onPreviewUrl?(listener: (url: string) => void): void
}

/**
 * Wire the job lifecycle onto a child process. Shared by the two ways one arrives:
 * spawned here for a `background: true` call, or ADOPTED from the foreground path
 * after outrunning its timeout ({@link adoptChildBgProc}).
 *
 * `initialOutput` is the foreground capture from before a handover. It replays to the
 * first listener ahead of any live chunk, so promoting a slow command never costs the
 * model the lines it already produced. `resume()` is what restarts an adopted child's
 * PAUSED streams (see spawn.ts's handover) and a harmless no-op for a fresh one.
 */
function wireBgProc(child: ReturnType<typeof spawn>, initialOutput?: string): BgProc {
  let resolveExit: (code: number | null) => void = () => {}
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = resolve
  })
  // The job is THE COMMAND: it is over when the command's process is gone.
  // Waiting for `'close'` instead would hold the job open for as long as ANYTHING
  // the command left behind keeps our stdout pipe (`foo &`, a build daemon that
  // escaped the process group) — a job that reports "running" forever, never emits
  // `done`, never notifies, and whose Kill cannot even settle it (`kill(-pid)`
  // cannot reach a daemon that left our group). See lib/child-exit.ts.
  // The foreground path (`environments/spawn.ts`) already returns on shell exit for
  // exactly this reason; this aligns the background path with it.
  // Fatal-exit safety net: a background job is detached into its own process group, so
  // nothing reaches it if the server dies without running its async shutdown. Untracked
  // the moment it settles, so the registry stays the live set.
  const untrack = trackSpawnedProcess(child.pid)
  void awaitChildGone(child).then(({ code, viaExit }) => {
    // Something the command left behind still holds the pipes: stop feeding a
    // finished job, but let that survivor keep writing into the void.
    if (viaExit) releaseChildPipes(child)
    untrack()
    resolveExit(code)
  })
  return {
    onOutput: (cb) => {
      if (initialOutput) cb(initialOutput)
      // One decoder per stream: a read boundary inside a multi-byte character
      // would otherwise reach the agent as U+FFFD. See lib/stream-text.ts.
      const decodeOut = createStreamTextDecoder()
      const decodeErr = createStreamTextDecoder()
      child.stdout?.on('data', (b: Buffer) => cb(decodeOut(b)))
      child.stderr?.on('data', (b: Buffer) => cb(decodeErr(b)))
      child.stdout?.resume()
      child.stderr?.resume()
    },
    write: (text) => {
      try {
        child.stdin?.write(text)
      } catch {
        /* broken pipe / exited */
      }
    },
    kill: () => {
      // The handle, not the pid, decides whether the delayed SIGKILL still has a target.
      if (child.pid) killProcessTree(child.pid, undefined, stillRunning(child))
    },
    exited,
  }
}

/**
 * Adopt a child handed over by `spawnToResult`'s `onTimeout: 'detach'`: the command
 * outran its foreground budget but is still working, so it becomes a background job
 * instead of being destroyed. `bufferedOutput` seeds the job with everything the
 * foreground already captured.
 */
export function adoptChildBgProc(child: ReturnType<typeof spawn>, bufferedOutput: string): BgProc {
  return wireBgProc(child, bufferedOutput)
}

/**
 * A detached child-process background job (combined stdout+stderr → onOutput).
 *
 * `envOverrides` exists for values that must reach the process but must NOT reach its command
 * line: a monitor injects resolved vault secrets here, because a process's environment is
 * readable only by its owner while `argv` is visible to every local process through `ps`.
 */
export function childBgProc(
  command: string,
  cwd: string,
  pathPrefix?: string[],
  envOverrides?: NodeJS.ProcessEnv,
): BgProc {
  const { shell, args } = resolveShellConfig()
  // Defense-in-depth: never spawn in a directory that has vanished (e.g. a pruned
  // directory that has since been removed) — that surfaces as a cryptic
  // `ENOENT posix_spawn '/bin/bash'`. The resolved-cwd seam (session-cwd.ts) is the
  // primary guard; this catches any other caller and keeps the command runnable.
  const safeCwd = cwd && existsSync(cwd) ? cwd : homedir()
  const child = spawn(shell, [...args, command], {
    cwd: safeCwd,
    // The user's real login-shell env (repaired PATH + stack vars, even under a
    // bare GUI launch — see lib/login-shell-env.ts) plus the unattended overlay:
    // a background job has no interactive TTY, so scaffolders/git must fail fast
    // instead of prompting. stdin stays open so the agent can still `write()` to
    // a job that wants input. ssh/docker backends set the remote env far-side.
    // Enabled plugins' `bin/` dirs (pathPrefix) go to the FRONT of PATH.
    env: childEnvNonInteractive(envOverrides, pathPrefix),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  return wireBgProc(child)
}

/** A PTY-pane background job (interactive terminal the user can see). */
export async function ptyBgProc(
  spawnTerminalJob: SpawnTerminalJob,
  cwd: string,
  command: string,
  opts: { wakesAgent?: boolean } = {},
): Promise<BgProc> {
  const handle: TerminalJobHandle = await spawnTerminalJob({
    cwd,
    command,
    ...(opts.wakesAgent ? { wakesAgent: true } : {}),
  })
  let resolveExit: (code: number | null) => void = () => {}
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = resolve
  })
  handle.onExit((code) => resolveExit(code))
  return {
    onOutput: (cb) => handle.onData(cb),
    write: (text) => handle.write(text),
    kill: (reason) => handle.kill(reason),
    exited,
    terminalId: handle.terminalId,
    onPreviewUrl: handle.onPreviewUrl ? (cb) => handle.onPreviewUrl!(cb) : undefined,
  }
}
