/**
 * The ONE file in `features/monitors` that touches the process layer.
 *
 * Both capabilities a source needs already exist and are load-bearing elsewhere, so a monitor
 * borrows them rather than spawning its own way:
 *
 *   - `childBgProc` (the background half of `bash`) — the user's real login-shell env, a
 *     detached process group so a kill reaches descendants, per-stream UTF-8 decoding, and
 *     the orphan guard that reaps a job if the server dies without a clean shutdown.
 *   - `spawnToResult` (the shared foreground spawner) — the capture cap, the timeout that
 *     reaps the process TREE, and one implementation of both for every backend.
 *
 * Keeping both imports here means the service and the sources stay injectable: a test passes
 * fakes for `BackgroundSpawn` / `CheckRun` and never starts a process.
 */
import { childBgProc } from '../../agent-core/tools/bash/bash-process'
import { resolveShellConfig } from '../../agent-core/tools/environments/shell'
import { spawnToResult } from '../../agent-core/tools/environments/spawn'
import { childEnvNonInteractive } from '../../../lib/login-shell-env'
import type { BackgroundSpawn, CheckRun } from './index'

export const nativeBackgroundSpawn: BackgroundSpawn = ({ command, cwd, pathPrefix, env }) =>
  childBgProc(command, cwd, pathPrefix, env)

export const nativeCheckRun: CheckRun = async ({ command, cwd, timeoutMs, pathPrefix, env }) => {
  const { shell, args } = resolveShellConfig()
  const result = await spawnToResult(shell, [...args, command], {
    cwd,
    timeout: timeoutMs,
    // A check runs unattended: no TTY, so scaffolders and git must fail fast rather than
    // block on a prompt no one can answer. Same overlay the background path uses. Injected
    // vault values (`env`) ride the same overrides slot — they must reach the process without
    // ever entering `command`.
    env: childEnvNonInteractive(env, pathPrefix),
  })
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
}
