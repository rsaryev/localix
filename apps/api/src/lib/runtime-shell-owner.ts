import { execFileSync } from 'node:child_process'

import type { RuntimeEndpoint } from './runtime-endpoint'
import { DESKTOP_RUNTIME_ARG } from './runtime-protocol'
import { processIsAlive } from './process-liveness'

/**
 * Which LIVE desktop shell, if any, owns a running runtime — so a second shell never takes the
 * database away from it.
 *
 * Two copies of the app with one bundle id (an installed release and a local build) both start a
 * runtime over `~/.localix`. A desktop runtime that found the other copy's runtime on a different
 * build used to stop it and take over; that shell's supervisor then restarted ITS runtime, which
 * stopped this one, and the two copies took the database from each other every few seconds. A
 * runtime whose shell is gone (an update relaunch, a crashed shell) is still fair to replace; one
 * whose shell is alive belongs to that shell.
 */
export class RuntimeOwnedElsewhereError extends Error {
  constructor(
    readonly shellPid: number,
    readonly baseUrl: string,
  ) {
    super(`Localix at ${baseUrl} is owned by another running Localix app (pid ${shellPid})`)
    this.name = 'RuntimeOwnedElsewhereError'
  }
}

export interface ProcessFacts {
  ppid: number
  command: string
}

export interface ShellOwnerProbe {
  describe(pid: number): ProcessFacts | null
  isAlive(pid: number): boolean
}

/** `ps -o ppid=,command=` output for one process, or null when it names none. */
export function parseProcessFacts(output: string): ProcessFacts | null {
  const match = /^\s*(\d+)\s+(.*)$/s.exec(output.trim())
  if (!match) return null
  return { ppid: Number(match[1]), command: match[2]!.trim() }
}

const systemProbe: ShellOwnerProbe = {
  describe(pid) {
    if (process.platform === 'win32') return null
    try {
      const output = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_000,
        windowsHide: true,
      })
      return parseProcessFacts(output)
    } catch {
      return null
    }
  },
  isAlive: processIsAlive,
}

/**
 * The pid of the live desktop shell that owns `endpoint`'s runtime, or null when it may be
 * replaced: no shell (a daemon, a dev server), a shell that is gone (the runtime was reparented),
 * or a shell that is this one or the one that launched it (tauri's restart spawns the new shell
 * as a child of the old one).
 */
export function owningShellPid(
  endpoint: RuntimeEndpoint,
  ownShellPid: number,
  probe: ShellOwnerProbe = systemProbe,
): number | null {
  const runtime = probe.describe(endpoint.pid)
  if (!runtime) return null
  const desktop = endpoint.shellPid !== undefined || runtime.command.includes(DESKTOP_RUNTIME_ARG)
  if (!desktop) return null
  const shell = runtime.ppid
  // Recorded but no longer its parent: the shell died and the runtime was reparented.
  if (endpoint.shellPid !== undefined && endpoint.shellPid !== shell) return null
  if (shell <= 1 || shell === ownShellPid || shell === process.pid) return null
  if (shell === probe.describe(ownShellPid)?.ppid) return null
  return probe.isAlive(shell) ? shell : null
}
