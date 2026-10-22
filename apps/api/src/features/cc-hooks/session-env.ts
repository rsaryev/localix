/**
 * Claude Code's `CLAUDE_ENV_FILE`: a file SessionStart, CwdChanged and FileChanged hooks append
 * `export` lines to, which every later Bash command of the session runs before itself.
 *
 * Two files, because their lifetimes differ (hooks.md): what SessionStart wrote lasts the
 * session, while what CwdChanged and FileChanged wrote lasts "until the next CwdChanged event,
 * when Claude Code clears them". The bash tool sources both, the session's first.
 *
 * Layer: api feature module (node:fs only).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CcHookEvent } from './contracts'

export interface CcSessionEnvFiles {
  /** Written by SessionStart hooks; kept for the session. */
  sessionStart: string
  /** Written by CwdChanged and FileChanged hooks; cleared on each CwdChanged. */
  cwd: string
}

/** The session's two env files inside `dir` (a folder that belongs to the session). */
export function ccSessionEnvFiles(dir: string): CcSessionEnvFiles {
  return { sessionStart: join(dir, 'session-start-env.sh'), cwd: join(dir, 'cwd-env.sh') }
}

/** The files a Bash command runs before itself, in order. */
export function ccSessionEnvScripts(files: CcSessionEnvFiles): string[] {
  return [files.sessionStart, files.cwd]
}

/**
 * The `CLAUDE_ENV_FILE` an event's hooks get, its folder created so `>> "$CLAUDE_ENV_FILE"`
 * works; undefined for every other event.
 */
export function envFileForEvent(
  files: CcSessionEnvFiles | undefined,
  event: CcHookEvent,
): string | undefined {
  if (!files) return undefined
  const file =
    event === 'SessionStart'
      ? files.sessionStart
      : event === 'CwdChanged' || event === 'FileChanged'
        ? files.cwd
        : undefined
  if (!file) return undefined
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    return undefined
  }
  return file
}

/** A CwdChanged clears what CwdChanged and FileChanged hooks wrote before it. */
export function clearCwdEnvFile(files: CcSessionEnvFiles | undefined): void {
  if (!files) return
  try {
    mkdirSync(dirname(files.cwd), { recursive: true })
    writeFileSync(files.cwd, '')
  } catch {
    // Best effort: a missing folder means nothing was written to clear.
  }
}
