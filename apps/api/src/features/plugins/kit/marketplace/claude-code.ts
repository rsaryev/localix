import {
  createPolicyView,
  enabledPlugin,
  pluginConfig,
  type FileScope,
} from '@rsaryev/llx-plugin/settings'
import { isFileScope } from '@rsaryev/llx-plugin/settings'
import {
  createStoreLayout,
  resolvePluginsRoot,
  SCOPES_BY_PRECEDENCE,
  type InstallRecord,
  type StoreLayout,
} from '@rsaryev/llx-plugin/marketplace'
import { join } from 'node:path'
import { claudeConfigDir } from '../../../cc-settings/config-dir'
import { readClaudeSettings, type ClaudeSettingsInput } from '../settings/read'

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

/**
 * Where Claude Code keeps its plugins (`resolvePluginsRoot`, `createStoreLayout`):
 * `CLAUDE_CODE_PLUGIN_CACHE_DIR` when set, else `plugins` under its configuration directory.
 */
export function claudeCodePluginStore(
  homeDir: string,
  env: Record<string, string | undefined> = process.env,
): StoreLayout {
  const root = resolvePluginsRoot({
    home: homeDir,
    override: env.CLAUDE_CODE_PLUGIN_CACHE_DIR,
    configDir: claudeConfigDir(homeDir, env),
    join,
  })
  return createStoreLayout(root, join)
}

/**
 * Of a plugin's install records that apply in the folder (`installsAt`), the one that loads: the
 * scope that wins by the one precedence table (`SCOPES_BY_PRECEDENCE`: managed, local, project, user).
 */
export const winningInstall = (applying: readonly InstallRecord[]): InstallRecord | undefined =>
  SCOPES_BY_PRECEDENCE.map((scope) => applying.find((one) => one.scope === scope)).find(
    (one) => one !== undefined,
  )
