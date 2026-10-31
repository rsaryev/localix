import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { UiSettings, AgentSettings } from '@/shared/api/contracts'

/**
 * THE SETTINGS SHAPE, AND THE FIRST-PAINT CACHE — deliberately the only module that touches
 * `localStorage` for settings.
 *
 * The cache exists for one frame: the store seeds from it synchronously at module load so the
 * first paint has the user's fonts and keybindings instead of flashing defaults. It is NEVER a
 * source of truth and NEVER a source of writes — the full precedence rule, and what went wrong
 * when a value read from here reached the server, is documented on the store itself. Keeping the
 * two `localStorage` calls here means "who may write settings to the wire" stays a question with
 * exactly one file to read.
 */
export interface UserSettings {
  uiSettings: UiSettings
  agentSettings: AgentSettings
}

export const DEFAULT_SETTINGS: UserSettings = {
  uiSettings: {},
  agentSettings: {},
}

const LS_KEY = 'localix_user_settings_v2'

export function loadLocalSettings(): UserSettings {
  const stored = loadJSON<Partial<UserSettings>>(LS_KEY)
  if (!stored) return { ...DEFAULT_SETTINGS }
  return { uiSettings: stored.uiSettings ?? {}, agentSettings: stored.agentSettings ?? {} }
}

export function saveLocalSettings(s: UserSettings): void {
  saveJSON(LS_KEY, s)
}
