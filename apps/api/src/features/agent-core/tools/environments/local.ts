import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from '../file/file-utils'
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentConfig,
  SearchFilesOptions,
} from '../environment'
import { interpretRipgrep } from '../environment'
import { buildRipgrepArgs } from './ripgrep'
import { resolveShellConfig } from './shell'
import { spawnToResult } from './spawn'
import { childEnv, childEnvNonInteractive } from '../../../../lib/login-shell-env'
import type { DetachedChild } from './spawn'

export class LocalEnvironment implements ExecutionEnvironment {
  readonly config: ExecutionEnvironmentConfig = { kind: 'local' }

  async readFile(filePath: string, signal?: AbortSignal): Promise<string> {
    // Pass the turn's abort signal to node so a large read stops mid-flight when the
    // run is cancelled, matching exec/searchFiles (a huge file otherwise reads to
    // completion into memory even though the result will be discarded).
    return readFile(filePath, { encoding: 'utf8', signal })
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    // Atomic: temp file in the same directory + rename, so a crash or concurrent
    // reader never observes a half-written file.
    await atomicWriteFile(filePath, content)
  }

  async exec(
    command: string,
    opts?: {
      cwd?: string
      timeout?: number
      uncapped?: boolean
      signal?: AbortSignal
      pathPrefix?: string[]
      onTimeout?: 'kill' | 'detach'
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number; detached?: DetachedChild }> {
    const { shell, args } = resolveShellConfig()
    return spawnToResult(shell, [...args, command], {
      cwd: opts?.cwd,
      timeout: opts?.timeout,
      uncapped: opts?.uncapped,
      signal: opts?.signal,
      // Only this backend owns a local child, so only this backend can hand one over.
      onTimeout: opts?.onTimeout,
      // The agent's shell has no TTY — hand it the user's real login-shell env
      // (repaired PATH + every stack's vars under a GUI launch) plus the
      // fail-fast non-interactive overlay so a scaffolder/git prompt can't hang.
      // Enabled plugins' `bin/` dirs (pathPrefix) go to the FRONT of PATH.
      env: childEnvNonInteractive(undefined, opts?.pathPrefix),
    })
  }

  async searchFiles(pattern: string, cwd: string, opts?: SearchFilesOptions): Promise<string> {
    // Flag set is shared with the ssh/docker backends (buildRipgrepArgs) so the three
    // cannot drift; this backend spawns the tokens directly as argv.
    const args = buildRipgrepArgs(pattern, opts)
    const result = await spawnToResult('rg', args, {
      cwd,
      signal: opts?.signal,
      env: childEnv(),
      ...(opts?.timeoutSeconds ? { timeout: opts.timeoutSeconds } : {}),
    })
    return interpretRipgrep(result)
  }
}

export const localEnvironment = new LocalEnvironment()
