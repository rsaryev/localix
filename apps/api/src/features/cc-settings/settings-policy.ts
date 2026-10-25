import { isRecord } from '../../lib/record'
import { readSettingsLayers, type SettingsFilesInput, type SettingsLayer } from './settings-files'
import { mergeSettingsSources } from './settings-merge'

/**
 * TWO POLICY KEYS OF CLAUDE CODE'S SETTINGS THAT RESTRICT WHAT LOADS OR RUNS (settings-reference.md):
 *
 *   `disableSkillShellExecution`  from any file; managed settings win. When true, the `!` command
 *       lines of skills and custom commands from the person's, a project's or a plugin's files are
 *       replaced by a placeholder instead of running (skills.md, "Inject dynamic context").
 *   `strictPluginOnlyCustomization`  managed settings only. `true` locks all four kinds of
 *       customization, an array locks the kinds it names (`skills`, `agents`, `hooks`, `mcp`);
 *       a name it does not know is ignored. A locked kind loads only from plugins and managed
 *       settings, never from the person's or a project's own files.
 */

export type PluginOnlySurface = 'skills' | 'agents' | 'hooks' | 'mcp'

const SURFACES: readonly PluginOnlySurface[] = ['skills', 'agents', 'hooks', 'mcp']

/** The kinds the managed layer locks to plugin and managed sources. Other layers are not read. */
export function pluginOnlyLocks(layers: readonly SettingsLayer[]): ReadonlySet<PluginOnlySurface> {
  const locked = new Set<PluginOnlySurface>()
  for (const layer of layers) {
    if (layer.source !== 'policy') continue
    const value = layer.settings.strictPluginOnlyCustomization
    if (value === true) for (const surface of SURFACES) locked.add(surface)
    else if (Array.isArray(value))
      for (const named of value) {
        const surface = SURFACES.find((known) => known === named)
        if (surface) locked.add(surface)
      }
  }
  return locked
}

/** {@link pluginOnlyLocks} of the session's settings, the MDM policy included. */
export async function readPluginOnlyLocks(
  input: SettingsFilesInput,
): Promise<ReadonlySet<PluginOnlySurface>> {
  return pluginOnlyLocks(await readSettingsLayers(input))
}

/** Whether `disableSkillShellExecution` is true in the session's merged settings. */
export async function skillShellExecutionDisabled(input: SettingsFilesInput): Promise<boolean> {
  const merged = mergeSettingsSources(await readSettingsLayers(input))
  return isRecord(merged) && merged.disableSkillShellExecution === true
}
