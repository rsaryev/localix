import { spawn } from 'node:child_process'

import { childEnv } from '../../lib/login-shell-env'
import { killProcessTree, stillRunning } from '../../lib/process-tree'

/** Running the package manager or toolchain that installs a language server (`lsp-installer.ts`). */

export interface InstallCommand {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

const INSTALL_TIMEOUT_MS = 10 * 60_000
const OUTPUT_LIMIT = 16_384
/** What a package manager or toolchain prints when the network, not the package, is the problem. */
const OFFLINE_OUTPUT =
  /ConnectionRefused|ConnectionClosed|FailedToOpenSocket|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH|getaddrinfo|no such host|dial tcp|network is unreachable/i

export class InstallFailure extends Error {
  readonly reason: 'offline' | 'needs-toolchain' | 'failed'

  constructor(reason: InstallFailure['reason'], message: string) {
    super(message)
    this.reason = reason
  }
}

export interface CommandResult {
  code: number
  output: string
  /** The command ran out of time and its process tree was killed. */
  timedOut?: boolean
}

export interface RunCommandOptions {
  /** Test seam: schedule `fn` after `ms`; returns the cancel. */
  setTimer?: (fn: () => void, ms: number) => () => void
}

const realTimer = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

export function runCommand(
  call: InstallCommand,
  { setTimer = realTimer }: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    // A group of its own, so the timeout reaches what `go install` and `bun install` spawn.
    const proc = spawn(call.command, call.args, {
      cwd: call.cwd,
      env: childEnv(call.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT)
    }
    proc.stdout.on('data', keep)
    proc.stderr.on('data', keep)
    const cancel = setTimer(() => {
      timedOut = true
      killProcessTree(proc.pid, undefined, stillRunning(proc))
      // A descendant that left the group may hold the pipes open: the leader's exit is enough.
      proc.once('exit', () => resolve({ code: -1, output, timedOut: true }))
    }, INSTALL_TIMEOUT_MS)
    proc.once('error', (err) => {
      cancel()
      resolve({ code: -1, output: err.message })
    })
    proc.once('close', (code) => {
      cancel()
      if (!timedOut) resolve({ code: code ?? -1, output })
    })
  })
}

/** The last meaningful line of a failed command, for the status bar's detail. */
function lastLine(output: string): string {
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  return lines.at(-1)?.trim() ?? 'exited without output'
}

/** Run `call`; a non-zero exit fails as offline when the network was the problem. */
export async function runOrFail(
  run: (call: InstallCommand) => Promise<CommandResult>,
  call: InstallCommand,
  what: string,
): Promise<void> {
  const { code, output, timedOut } = await run(call)
  if (timedOut) {
    throw new InstallFailure(
      'failed',
      `${what}: timed out after ${INSTALL_TIMEOUT_MS / 60_000} minutes`,
    )
  }
  if (code === 0) return
  throw new InstallFailure(
    OFFLINE_OUTPUT.test(output) ? 'offline' : 'failed',
    `${what}: ${lastLine(output)}`,
  )
}
