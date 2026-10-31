import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { childEnvNonInteractive } from './login-shell-env'

const execFileAsync = promisify(execFile)

export type GitRunner = (args: string[]) => Promise<string | null>

/** Variables that point git at another repository (a hook exports them). */
const REPO_LOCATION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/** `env` without the variables that would point git at a repository other than the one a call names. */
export function withoutRepoLocation(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env }
  for (const key of REPO_LOCATION_VARS) delete clean[key]
  return clean
}

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
