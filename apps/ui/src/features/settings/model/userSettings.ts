import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { isModelRoutingTaskKey } from '@localixai/api/client'
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
  displayName: string
  responsePreferences: string
  primaryRole: string
  experienceLevel: string
  mainUseCase: string
  /** Free-text "what you're working on" — flushed to the profile's working_context
   *  so it reaches the agent's "# User profile" prompt section. */
  workingContext: string
  uiSettings: UiSettings
  agentSettings: AgentSettings
}

export const DEFAULT_SETTINGS: UserSettings = {
  displayName: '',
  responsePreferences: '',
  primaryRole: '',
  experienceLevel: '',
  mainUseCase: '',
  workingContext: '',
  uiSettings: {},
  agentSettings: {},
}

const LS_KEY = 'localix_user_settings_v2'

/** Project cached settings onto the current task catalog. Retired task routes have no owner. */
export function currentAgentSettings(settings: AgentSettings): AgentSettings {
  const routes = settings.modelRouting
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return settings
  return {
    ...settings,
    modelRouting: Object.fromEntries(
      Object.entries(routes).filter(([key]) => isModelRoutingTaskKey(key)),
    ) as AgentSettings['modelRouting'],
  }
}

export function loadLocalSettings(): UserSettings {
  const stored = loadJSON<Partial<UserSettings>>(LS_KEY)
  return stored
    ? {
        ...DEFAULT_SETTINGS,
        ...stored,
        agentSettings: currentAgentSettings(stored.agentSettings ?? {}),
      }
    : { ...DEFAULT_SETTINGS }
}

export function saveLocalSettings(s: UserSettings): void {
  saveJSON(LS_KEY, s)
}
