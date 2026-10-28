import type { PermissionMode } from '../../contracts/permission-modes'
import { isRecord } from '../../lib/record'
import { readSettingsLayers, type SettingsFilesInput } from './settings-files'
import { mergeSettingsSources, type SettingsSource } from './settings-merge'

/**
 * Claude Code's mode settings for a folder (permissions.md, "Permission modes"):
 * `permissions.defaultMode` — the mode a session starts in — as the Localix mode it names, and
 * `permissions.disableBypassPermissionsMode: "disable"` from any settings file.
 *
 * `auto` and `bypassPermissions` count only from the user and managed files, never from a project's
 * or the local one.
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
  // The layer that wins `defaultMode` (the last that sets it, lowest first). `auto` and
  // `bypassPermissions` take no effect from a project or local file, and the session then starts
  // in the built-in default rather than in a lower file's mode (permission-modes.md).
  let winner: { source: SettingsSource; mode: string } | undefined
  for (const layer of layers) {
    const permissions = layer.settings.permissions
    const mode = isRecord(permissions) ? permissions.defaultMode : undefined
    if (typeof mode === 'string') winner = { source: layer.source, mode }
  }
  const untrusted =
    winner &&
    (winner.source === 'project' || winner.source === 'local') &&
    (winner.mode === 'bypassPermissions' || winner.mode === 'auto')
  const named = winner && !untrusted ? MODES[winner.mode] : undefined
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
