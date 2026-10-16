import { setIslandEnabled, useIslandEnabled } from '@/shared/lib/islandSetting'
import { SettingsRows, SettingsSection } from './SettingsScaffold'
import { SwitchRow } from './SwitchRow'

/** Settings → Preferences → Agent island: the desktop shell's quick chat at the notch. */
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
      description="A quick chat at the top of the screen that shows when agents work or need you."
    >
      <SettingsRows>
        <SwitchRow
          title="Show the agent island"
          description="Hover the notch or press Cmd+Shift+J. When off, the shortcut and the Quick Chat menu item are hidden too."
          checked={enabled}
          onChange={toggle}
          label="Show the agent island"
        />
      </SettingsRows>
    </SettingsSection>
  )
}
