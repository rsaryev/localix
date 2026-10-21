import type { UserProfile, UiSettingsPatch, AgentSettingsPatch } from '@/shared/api/contracts'
import type { UserSettings } from './userSettings'
import { saveLocalSettings } from './userSettings'
import { resolveSettingsSync } from './settingsSyncResult'

interface ProfileReadState {
  settings: UserSettings
  synced: boolean
  _pending: Partial<UserSettings>
  _pendingUiSettingsPatch: UiSettingsPatch
  _pendingAgentSettingsPatch: AgentSettingsPatch
}

/** Both bootstrap and live reads preserve pending edits through the same precedence rule. */
export function applyProfileRead(state: ProfileReadState, profile: UserProfile) {
  const { settings, pending } = resolveSettingsSync(
    state.settings,
    {
      profile: state._pending,
      ui: state._pendingUiSettingsPatch,
      agent: state._pendingAgentSettingsPatch,
    },
    profile,
    state.synced,
  )
  saveLocalSettings(settings)
  return {
    settings,
    _pending: pending.profile,
    _pendingUiSettingsPatch: pending.ui,
    _pendingAgentSettingsPatch: pending.agent,
    synced: true,
    syncError: null,
  }
}
