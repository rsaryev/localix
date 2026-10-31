import { setIslandEnabled, useIslandEnabled } from '@/shared/lib/islandSetting'
import { SettingsRows, SettingsSection } from './SettingsScaffold'
import { SwitchRow } from './SwitchRow'

/** Settings → Preferences → Agent island: requests at the notch while Localix is in the background. */
export function IslandSection() {
  // Null outside the macOS desktop app; off until the person turns it on.
  const enabled = useIslandEnabled()
  if (enabled === null) return null
  const toggle = () => setIslandEnabled(!enabled)
  return (
    <SettingsSection
      anchor="prefs-island"
      title="Agent island"
      scope="device"
      description="Answer an agent's question or approval from the top of the screen when Localix is in the background."
    >
      <SettingsRows>
        <SwitchRow
          title="Show the agent island"
          description="A light runs along the notch while agents work. When an agent needs your answer and Localix is in the background, its request opens there; it folds back if you do not answer."
          checked={enabled}
          onChange={toggle}
          label="Show the agent island"
        />
      </SettingsRows>
    </SettingsSection>
  )
}
