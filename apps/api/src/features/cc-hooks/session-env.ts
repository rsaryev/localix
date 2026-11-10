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
import { join } from 'node:path'

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
