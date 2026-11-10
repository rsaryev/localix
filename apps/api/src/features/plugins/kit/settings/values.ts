import {
  readAgentSetting,
  readOutputStyleSetting,
  type PluginOnlySurface,
} from '@rsaryev/llx-plugin/settings'
import type { PermissionMode } from '../../../../contracts/permission-modes'
import type { ClaudeSettings } from './read'

/** Single settings values a Localix feature reads, each as the kit decides it. */

/** `strictPluginOnlyCustomization`: the kinds of customization only plugins (and the organization) may add. */
export const customizationLocks = (settings: ClaudeSettings): ReadonlySet<PluginOnlySurface> =>
  settings.policy().customization.locked

/** `disableSkillShellExecution` for the skills Localix runs (the person's, a project's, a plugin's). */
export const skillShellDisabled = (settings: ClaudeSettings): boolean =>
  !settings.policy().skills.shell('user').run

const trimmed = (value: string | undefined) => value?.trim() || undefined

/** `agent`: the agent the main conversation runs as. */
export const mainAgentSetting = (settings: ClaudeSettings): string | undefined =>
  trimmed(readAgentSetting(settings.policy().view))

/** `outputStyle`: the style a chat speaks in when none is chosen. */
export const outputStyleSetting = (settings: ClaudeSettings): string | undefined =>
  trimmed(readOutputStyleSetting(settings.policy().view))

/** Claude Code's modes as Localix names them; one Localix lacks starts in the built-in default. */
const MODES: Readonly<Record<string, PermissionMode>> = {
  default: 'default',
  plan: 'plan',
  bypassPermissions: 'bypass',
}

export interface SettingsModes {
  /** `permissions.defaultMode`, when the settings choose the mode a session starts in. */
  defaultMode?: PermissionMode
  /** `permissions.disableBypassPermissionsMode: "disable"` in any file. */
  bypassDisabled: boolean
}

/**
 * The starting mode the settings choose (`PermissionsPolicy.startingMode`, a non-interactive
 * launch: auto mode is not offered), and whether bypass is turned off.
 */
export function settingsModes(settings: ClaudeSettings): SettingsModes {
  const { permissions } = settings.policy()
  const start = permissions.startingMode({ surface: 'headless', autoAvailable: false })
  const mode =
    start.outcome === 'started' && start.source === 'settings' ? MODES[start.mode] : undefined
  return {
    ...(mode ? { defaultMode: mode } : {}),
    bypassDisabled: permissions.disableBypassPermissionsMode,
  }
}
