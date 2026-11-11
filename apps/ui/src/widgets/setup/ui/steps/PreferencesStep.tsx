import { SettingsControlRow, SettingsRows } from '@/features/settings/ui/SettingsScaffold'
import { BaseKeymapSelect } from '@/features/settings/ui/BaseKeymapSelect'
import { IslandSwitchRow } from '@/features/settings/ui/IslandSection'
import { ThemeField } from '@/features/settings/ui/ThemeField'
import { TransparencyField } from '@/features/settings/ui/TransparencyField'
import { SettingsLink, SetupLater } from '../SetupLater'

/**
 * Step three: the choices of this device with a default already good, as Settings draws them —
 * the same fields, so the two can never disagree. The island row shows only in the macOS app.
 */
export function PreferencesStep() {
  return (
    <>
      <p className="max-w-prose text-sm leading-6 text-text-soft text-pretty">
        How Localix looks and which keys it answers to, on this device. The defaults work; change
        what you like.
      </p>
      <SettingsRows className="mt-4">
        <ThemeField />
        <TransparencyField />
        <SettingsControlRow
          title="Base keymap"
          description="Start from the shortcuts of an editor you already use."
        >
          <BaseKeymapSelect />
        </SettingsControlRow>
        <IslandSwitchRow />
      </SettingsRows>
      <SetupLater>
        fonts and more in <SettingsLink tab="preferences">Preferences</SettingsLink>, every shortcut
        in <SettingsLink tab="shortcuts">Keyboard shortcuts</SettingsLink>.
      </SetupLater>
    </>
  )
}
