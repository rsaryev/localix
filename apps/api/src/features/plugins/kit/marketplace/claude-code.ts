import { parseInstalledPlugins, type InstalledRecords } from '@rsaryev/llx-plugin/marketplace'
import { createPolicyView, enabledPlugin, pluginConfig } from '@rsaryev/llx-plugin/settings'
import { readClaudeSettings, type ClaudeSettingsInput } from '../settings/read'

/**
 * What Claude Code's own files say about the plugins a person installed there, read by the kit
 * and never written: the install records of `installed_plugins.json` (`parseInstalledPlugins`),
 * whether each plugin is on (`enabledPlugin`: the highest file with an entry decides, managed
 * settings above every file), and the values its options were given (`pluginConfig`: user and
 * managed settings only).
 */

/** The settings file that decided a plugin: a scope, or the managed settings (`policy`). */
export type EnabledBy = 'user' | 'project' | 'local' | 'policy'

export interface ClaudeCodePluginSettings {
  /** The ids some file's `enabledPlugins` names, sorted. */
  readonly ids: readonly string[]
  /** Whether a file turns the plugin on or off; `undefined` when none has an entry. */
  enabled(id: string): { on: boolean; by: EnabledBy } | undefined
  options(id: string): Record<string, unknown>
}

const BY: Readonly<Record<string, EnabledBy>> = {
  user: 'user',
  project: 'project',
  local: 'local',
  managed: 'policy',
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
      const by = BY[decision.decidedBy]
      return by === undefined ? undefined : { on: decision.on, by }
    },
    options: (id) => ({ ...pluginConfig(view, id).options }),
  }
}

/** The records `installed_plugins.json` holds; a file this version cannot read is no installs. */
export const claudeCodeInstallRecords = (text: string | undefined): InstalledRecords =>
  parseInstalledPlugins(text).records
