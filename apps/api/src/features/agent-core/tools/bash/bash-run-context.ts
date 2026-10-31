import { type ExecutionEnvironment, resolveToolCwd } from '../environment'
import type { SpawnTerminalJob } from '../terminal/terminal-job'
import type { BashWaitHost } from './bash-until'
import type { BashToolInput } from './bash-types'
import type { SettleWindow } from './bash-background-settle'

/** Shared closure context every bash run path needs (resolved once per tool build). */
export interface BashRunContext {
  env: ExecutionEnvironment
  defaultCwd?: string
  /**
   * Whether a foreground command that outruns its timeout may be PROMOTED to a
   * background job instead of killed. Mirrors the tool's `allowBackground`: where
   * the model could not have asked for a job, it must not be handed one.
   */
  allowBackground?: boolean
  spawnTerminalJob?: SpawnTerminalJob
  /**
   * Enabled plugins' `bin/` directories, APPENDED to PATH for every bash
   * subprocess (foreground/batch/bg) so a plugin's bundled CLIs resolve by bare
   * name — matching Claude Code, where an enabled plugin's `bin/` is on the Bash
   * tool's PATH. Collected once from the loaded-plugins set; absent in tests.
   */
  pluginBinDirs?: string[]
  /** Host for `until` waits (see {@link BashToolOptions.waitHost}). */
  waitHost?: BashWaitHost
  /** Background settle window (see {@link BashToolOptions.backgroundSettle}). */
  backgroundSettle?: SettleWindow
  /** Shell files run before each command (see {@link BashToolOptions.envScripts}). */
  envScripts?: string[]
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * The command as the shell runs it: each env script that exists sourced first, in the same shell,
 * so its exports reach the command (Claude Code's `CLAUDE_ENV_FILE`). Local backend only: the
 * files are on this machine.
 */
export function withEnvScripts(ctx: BashRunContext, command: string): string {
  if (!ctx.envScripts?.length || ctx.env.config.kind !== 'local') return command
  const sourced = ctx.envScripts.map((file) => `[ -f ${quote(file)} ] && . ${quote(file)}`)
  return `${sourced.join('\n')}\n${command}`
}

/**
 * The command with the enabled plugins' `bin/` folders appended to PATH in the shell that runs it.
 * A child process gets them through its environment; a terminal pane runs a login shell whose
 * profile rebuilds PATH, so there they have to be set after it, in the command itself. After the
 * person's own PATH, as for a child process. POSIX shells only: a Windows pane keeps its PATH.
 */
export function withPluginPath(dirs: string[] | undefined, command: string): string {
  if (!dirs?.length || process.platform === 'win32') return command
  return `export PATH="$PATH":${dirs.map(quote).join(':')}\n${command}`
}

/**
 * Resolve a bash command's working directory — the BashToolInput-typed convenience
 * over {@link resolveToolCwd} (the cross-tool single source of truth), used by the
 * single, batch, foreground and background bash paths.
 */
export function resolveCwd(input: BashToolInput, defaultCwd?: string): string {
  return resolveToolCwd(input.cwd, defaultCwd)
}
