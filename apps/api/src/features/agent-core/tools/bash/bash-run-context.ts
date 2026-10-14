import { type ExecutionEnvironment, resolveToolCwd } from '../environment'
import type { SpawnTerminalJob } from '../terminal/terminal-job'
import type { BashWaitHost } from './bash-until'
import type { BashToolInput } from './bash-types'

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
   * Enabled plugins' `bin/` directories, PREPENDED to PATH for every bash
   * subprocess (foreground/batch/bg) so a plugin's bundled CLIs resolve by bare
   * name — matching Claude Code, where an enabled plugin's `bin/` is on the Bash
   * tool's PATH. Collected once from the loaded-plugins set; absent in tests.
   */
  pluginBinDirs?: string[]
  /** Host for `until` waits (see {@link BashToolOptions.waitHost}). */
  waitHost?: BashWaitHost
}

/**
 * Resolve a bash command's working directory — the BashToolInput-typed convenience
 * over {@link resolveToolCwd} (the cross-tool single source of truth), used by the
 * single, batch, foreground and background bash paths.
 */
export function resolveCwd(input: BashToolInput, defaultCwd?: string): string {
  return resolveToolCwd(input.cwd, defaultCwd)
}
