import type { UserProfile } from '@/shared/api/contracts'
import { mergeSettingDelta } from './settingsProfilePatch'
import { applySyncBarrier, type PendingWrites } from './settingsSyncBarrier'
import type { UserSettings } from './userSettings'

/** Bootstrap uses the sync barrier; peer refreshes merge around this window's unsaved edits. */
export function resolveSettingsSync(
  visible: UserSettings,
  pending: PendingWrites,
  profile: UserProfile,
  synced: boolean,
): { settings: UserSettings; pending: PendingWrites } {
  const committed = applySyncBarrier(visible, pending, profile)
  if (!synced) return committed
  return {
    settings: {
      uiSettings: mergeSettingDelta(committed.settings.uiSettings, visible.uiSettings, pending.ui),
      agentSettings: mergeSettingDelta(
        committed.settings.agentSettings,
        visible.agentSettings,
        pending.agent,
      ),
    },
    pending,
  }
}
