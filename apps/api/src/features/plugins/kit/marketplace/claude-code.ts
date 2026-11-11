import {
  createPolicyView,
  enabledPlugin,
  pluginConfig,
  type FileScope,
} from '@rsaryev/llx-plugin/settings'
import { isFileScope, readClaudeSettings, type ClaudeSettingsInput } from '../settings/read'

/**
 * What Claude Code's own files say about the plugins a person installed there, read by the kit
 * and never written (the install records of `installed_plugins.json` are the kit's
 * `parseInstalledPlugins`): whether each plugin is on (`enabledPlugin`: the highest file with an entry decides, managed
 * settings above every file), and the values its options were given (`pluginConfig`: user and
 * managed settings only).
 */

export interface ClaudeCodePluginSettings {
  /** The ids some file's `enabledPlugins` names, sorted. */
  readonly ids: readonly string[]
  /** Whether a file turns the plugin on or off; `undefined` when none has an entry. */
  enabled(id: string): { on: boolean; by: FileScope } | undefined
  options(id: string): Record<string, unknown>
}

export async function claudeCodePluginSettings(
  input: Pick<ClaudeSettingsInput, 'homeDir' | 'cwd' | 'env' | 'managed'>,
): Promise<ClaudeCodePluginSettings> {
  const settings = await readClaudeSettings(input).catch(() => undefined)
  const view = createPolicyView(settings?.layers ?? [])
  const ids = view.eachFromHighest('enabledPlugins').flatMap((holder) => Object.keys(holder.value))
  return {
    ids: [...new Set(ids)].sort(),
    enabled(id) {
      const decision = enabledPlugin(view, id)
      const by = decision.decidedBy
      return isFileScope(by) ? { on: decision.on, by } : undefined
    },
    options: (id) => ({ ...pluginConfig(view, id).options }),
  }
}
