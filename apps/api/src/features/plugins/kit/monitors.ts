import type { PluginSession } from '@rsaryev/llx-plugin'
import { issueLine } from './catalog/read-folder'

/**
 * One plugin monitor a chat's kit session hands out to start now (`session.monitorsToStart`,
 * plugins/components.md, "Monitors"), ready to spawn: run `command` through a POSIX shell in `cwd`
 * with exactly `env`. `command` keeps its `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and
 * `${CLAUDE_PROJECT_DIR}` references and `env` carries their values, so a folder named with shell
 * syntax is data to the shell, never code.
 */
export interface MonitorLaunch {
  /** The declaring plugin's `name@marketplace`. */
  readonly pluginId: string
  readonly pluginName: string
  readonly name: string
  readonly description: string
  readonly command: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

export interface MonitorLaunches {
  readonly launches: readonly MonitorLaunch[]
  /** The monitors that must not start (a `${user_config.*}` in `command`), each said once. */
  readonly problems: readonly string[]
}

/**
 * The monitors the session has to start now: when it opens, after its plugins changed and after a
 * skill it expanded, each once per session (the session keeps that ledger, and records the skills
 * itself). Nothing in a non-interactive session.
 */
export async function monitorsToLaunch(
  session: PluginSession,
  signal?: AbortSignal,
): Promise<MonitorLaunches> {
  const { resolved, issues } = await session.monitorsToStart(signal ? { signal } : {})
  const names = new Map(session.plugins.map((plugin) => [plugin.id, plugin.name]))
  return {
    launches: resolved.map(({ monitor, cwd, env }) => ({
      pluginId: monitor.pluginId,
      pluginName: names.get(monitor.pluginId) ?? monitor.pluginId,
      name: monitor.name,
      description: monitor.description,
      command: monitor.command,
      cwd,
      env,
    })),
    problems: issues.map(issueLine),
  }
}
