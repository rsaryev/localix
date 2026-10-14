/**
 * Cross-platform planning for installing the `localix` shell command into the
 * user's PATH — the "install the command-line launcher" flow of a desktop app.
 * Pure + injectable (platform/home/paths are parameters) so the tricky per-OS
 * decisions are unit-tested; the service layer just executes this plan with fs.
 *
 * We install into a USER-writable bin dir (no sudo / privilege prompt):
 *   posix  → ~/.local/bin/localix            (a `sh` launcher)
 *   win32  → %LOCALAPPDATA%\Localix\bin\localix.cmd  (a cmd shim)
 * and, when that dir isn't already on PATH, report the shell-rc / PATH edit needed.
 */

import path from 'node:path'
import { shellQuote } from '../agent-core/tools/environment'

export type ShellPlatform = 'darwin' | 'win32' | 'linux'

export interface ShellCommandPlanInput {
  platform: ShellPlatform
  /** The user's home directory. */
  home: string
  /** Absolute path to the CLI entry the launcher execs (packages/cli/bin/localix.mjs). */
  cliEntry: string
  /** Absolute path to the Bun runtime that runs the CLI entry. */
  bunPath: string
  /** %LOCALAPPDATA% on Windows; ignored elsewhere. Falls back to <home>\AppData\Local. */
  localAppData?: string
}

export interface ShellCommandPlan {
  /** Absolute path where the launcher is written. */
  targetPath: string
  /** Directory holding the launcher — must be on PATH for `localix` to resolve. */
  binDir: string
  /** Launcher file contents. */
  launcher: string
  /** POSIX file mode for the launcher (executable). Irrelevant on Windows. */
  mode: number
  kind: 'posix-script' | 'windows-cmd'
}

/**
 * Compute where + what to install for the `localix` launcher. The launcher simply
 * forwards all args to the bundled CLI entry under Bun, so `localix .`,
 * `localix <path>` and `localix help` all funnel through the same typed CLI.
 */
export function planShellCommand(input: ShellCommandPlanInput): ShellCommandPlan {
  const { platform, home, cliEntry, bunPath } = input

  if (platform === 'win32') {
    const localAppData = input.localAppData || path.win32.join(home, 'AppData', 'Local')
    const binDir = path.win32.join(localAppData, 'Localix', 'bin')
    const targetPath = path.win32.join(binDir, 'localix.cmd')
    // %* forwards all args; quotes guard spaces in the bun/CLI paths.
    const launcher = `@echo off\r\n"${bunPath}" "${cliEntry}" %*\r\n`
    return { targetPath, binDir, launcher, mode: 0o755, kind: 'windows-cmd' }
  }

  const binDir = path.posix.join(home, '.local', 'bin')
  const targetPath = path.posix.join(binDir, 'localix')
  const launcher = `#!/bin/sh\nexec ${shellQuote(bunPath)} ${shellQuote(cliEntry)} "$@"\n`
  return { targetPath, binDir, launcher, mode: 0o755, kind: 'posix-script' }
}

/**
 * Whether `binDir` is already present in a PATH env string (`:`-sep on posix,
 * `;`-sep on Windows, case-insensitive there). Drives whether the installer must
 * also add a PATH entry (shell-rc line / user PATH edit).
 */
export function isDirOnPath(binDir: string, pathEnv: string, platform: ShellPlatform): boolean {
  const sep = platform === 'win32' ? ';' : ':'
  const norm = (p: string) => (platform === 'win32' ? p.toLowerCase() : p).replace(/[\\/]+$/, '')
  const target = norm(binDir)
  return pathEnv
    .split(sep)
    .map((p) => norm(p.trim()))
    .some((p) => p === target)
}
