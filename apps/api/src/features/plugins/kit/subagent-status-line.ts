import type { PluginSession } from '@rsaryev/llx-plugin'
import type { LoadedKitPlugin } from './host'

/**
 * The `subagentStatusLine` a chat's session runs, as the kit picks it (`session.subagentStatusLine`;
 * statusline.md, "Subagent status lines"): the settings' value, else the enabled plugins' default
 * (the plugin loaded last), under the gates of `statusLine` (the folder's trust, `disableAllHooks`,
 * `allowManagedHooksOnly`, under which a plugin's value never runs). Its input, the run and the rows it
 * rewrites are the kit's too (`plugins/subagent-status-line.ts`); the refresh and the environment
 * stay Localix's (`chat/service/subagent-rows.ts`).
 */
export interface ChosenSubagentStatusLine {
  readonly command: string
  /** The plugin whose default it is: its id (`CLAUDE_PLUGIN_DATA`), name and folder; absent for a settings file's. */
  readonly plugin?: { readonly id: string; readonly name: string; readonly root: string }
}

export function chosenSubagentStatusLine(
  session: Pick<PluginSession, 'subagentStatusLine'>,
  plugins: readonly LoadedKitPlugin[],
): ChosenSubagentStatusLine | undefined {
  const runs = session.subagentStatusLine().runs
  if (!runs?.value.command.trim()) return undefined
  if (!('plugin' in runs)) return { command: runs.value.command }
  const root = plugins.find((one) => one.id === runs.plugin.id)?.root
  // A default of a plugin the host did not give is none it can run in the plugin's folder.
  if (root === undefined) return undefined
  return {
    command: runs.value.command,
    plugin: { id: runs.plugin.id, name: runs.plugin.name, root },
  }
}
