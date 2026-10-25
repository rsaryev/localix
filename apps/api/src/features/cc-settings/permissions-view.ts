import { isRecord } from '../../lib/record'
import { readSettingsLayers, type SettingsFilesInput } from './settings-files'
import { mergeSettingsSources } from './settings-merge'
import { settingsPermissionRules, type CcEffect } from './settings-permissions'
import { claudeCodeTrusts } from './settings-trust'

/**
 * WHAT THE PERSON'S CLAUDE CODE SETTINGS SAY ABOUT PERMISSIONS, for Settings → Permissions to
 * show read-only: the rules the gate already honours (`settingsPermissionRules`, trust applied),
 * `permissions.defaultMode` as Claude Code names it and the bypass lock. Nothing is written.
 */
export interface ClaudeCodePermissionsView {
  defaultMode: string | null
  bypassDisabled: boolean
  rules: Array<{ effect: CcEffect; rule: string; file: string }>
}

export async function describeClaudeCodePermissions(
  input: SettingsFilesInput,
): Promise<ClaudeCodePermissionsView> {
  const layers = await readSettingsLayers(input)
  const merged = mergeSettingsSources(layers)
  const permissions = isRecord(merged.permissions) ? merged.permissions : {}
  const rules = settingsPermissionRules(layers, {
    projectTrusted: input.cwd ? claudeCodeTrusts({ ...input, cwd: input.cwd }) : false,
  })
  return {
    defaultMode: typeof permissions.defaultMode === 'string' ? permissions.defaultMode : null,
    bypassDisabled: layers.some(
      (layer) =>
        isRecord(layer.settings.permissions) &&
        layer.settings.permissions.disableBypassPermissionsMode === 'disable',
    ),
    rules: rules.map(({ effect, raw, file }) => ({ effect, rule: raw, file })),
  }
}
