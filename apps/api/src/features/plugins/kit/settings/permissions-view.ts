import { readClaudeSettings, type ClaudeSettingsInput } from './read'
import { settingsRuleEntries, type SettingsRuleEntry } from './permissions'

/**
 * WHAT THE PERSON'S CLAUDE CODE SETTINGS SAY ABOUT PERMISSIONS, for Settings → Permissions to
 * show read-only: the rules the gate already honours (`settingsRuleEntries`, trust applied),
 * `permissions.defaultMode` as Claude Code names it and the bypass lock. Nothing is written.
 */
export interface ClaudeCodePermissionsView {
  defaultMode: string | null
  bypassDisabled: boolean
  rules: Array<{ effect: SettingsRuleEntry['effect']; rule: string; file: string }>
}

export async function describeClaudeCodePermissions(
  input: ClaudeSettingsInput,
): Promise<ClaudeCodePermissionsView> {
  const settings = await readClaudeSettings(input)
  const { view, permissions } = settings.policy()
  return {
    defaultMode: view.get('permissions')?.defaultMode ?? null,
    bypassDisabled: permissions.disableBypassPermissionsMode,
    rules: settingsRuleEntries(settings).map(({ effect, raw, file }) => ({
      effect,
      rule: raw,
      file,
    })),
  }
}
