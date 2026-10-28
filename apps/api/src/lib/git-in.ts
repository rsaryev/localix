import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { childEnvNonInteractive } from './login-shell-env'

const execFileAsync = promisify(execFile)

export type GitRunner = (args: string[]) => Promise<string | null>

/**
 * Git, run in `cwd` with the person's own environment minus the variables that redirect it
 * (`GIT_DIR`, `GIT_WORK_TREE`, …). Resolves to the output without its trailing whitespace, or
 * `null` when git is missing, fails, finds no repository or outlasts `timeoutMs`.
 */
export function gitIn(
  cwd: string,
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): GitRunner {
  return async (args) => {
    const env = childEnvNonInteractive()
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', cwd, '-c', 'core.quotepath=false', ...args],
        {
          timeout: options.timeoutMs ?? 10_000,
          maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
          env,
          windowsHide: true,
        },
      )
      return String(stdout).replace(/\s+$/, '')
    } catch {
      return null
    }
  }
}
