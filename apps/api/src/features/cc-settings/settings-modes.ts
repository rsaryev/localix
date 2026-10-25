import type { PermissionMode } from '../../contracts/permission-modes'
import { isRecord } from '../../lib/record'
import { readSettingsLayers, type SettingsFilesInput } from './settings-files'
import { mergeSettingsSources } from './settings-merge'

/**
 * Claude Code's mode settings for a folder (permissions.md, "Permission modes"):
 * `permissions.defaultMode` — the mode a session starts in — as the Localix mode it names, and
 * `permissions.disableBypassPermissionsMode: "disable"` from any settings file.
 *
 * `default` (also `manual`), `plan` and `bypassPermissions` have a Localix mode of the same
 * meaning. `acceptEdits`, `auto` and `dontAsk` have none — Localix has no edit-only, classifier
 * or deny-what-would-ask mode — so a conversation there starts in Default.
 */
const MODES: Readonly<Record<string, PermissionMode>> = {
  default: 'default',
  manual: 'default',
  plan: 'plan',
  bypassPermissions: 'bypass',
}

export async function claudeCodeModes(
  input: SettingsFilesInput,
): Promise<{ defaultMode?: PermissionMode; bypassDisabled: boolean }> {
  const layers = await readSettingsLayers(input)
  const merged = mergeSettingsSources(layers)
  const permissions = isRecord(merged.permissions) ? merged.permissions : {}
  const named =
    typeof permissions.defaultMode === 'string' ? MODES[permissions.defaultMode] : undefined
  // A lock: "disable" in any file holds, whatever a higher file says.
  const bypassDisabled = layers.some(
    (layer) =>
      isRecord(layer.settings.permissions) &&
      layer.settings.permissions.disableBypassPermissionsMode === 'disable',
  )
  return { ...(named ? { defaultMode: named } : {}), bypassDisabled }
}

/**
 * The `agent` setting (sub-agents.md, "Run the whole session as a subagent"): the name of the agent
 * the main thread runs as, from the same files and in the same order as every other setting. A
 * plugin's own `agent` is the lowest layer and is read with the plugin, not here.
 */
export async function claudeCodeMainAgent(input: SettingsFilesInput): Promise<string | undefined> {
  const named = mergeSettingsSources(await readSettingsLayers(input)).agent
  return typeof named === 'string' && named.trim() ? named.trim() : undefined
}
