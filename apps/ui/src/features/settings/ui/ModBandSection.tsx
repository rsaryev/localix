import { setModBandRotation, useModBandRotation } from '@/shared/lib/modBandRotationPref'
import { SettingsRows, SettingsSection } from './SettingsScaffold'
import { SwitchRow } from './SwitchRow'

/** Settings → Preferences → Mods band: the band of mod output above the composer. */
export function ModBandSection() {
  const rotate = useModBandRotation()
  return (
    <SettingsSection
      anchor="prefs-mod-band"
      title="Mods band"
      scope="device"
      description="When a mod replaces what the other mods draw above the composer, the band offers each of them as a page."
    >
      <SettingsRows>
        <SwitchRow
          title="Rotate mod band pages"
          description="Turn to the next page every few seconds while you are not typing, hovering or focused in the band, and no turn is running. Never with reduced motion; a page you pick stays."
          checked={rotate}
          onChange={() => setModBandRotation(!rotate)}
          label="Rotate mod band pages"
        />
      </SettingsRows>
    </SettingsSection>
  )
}
