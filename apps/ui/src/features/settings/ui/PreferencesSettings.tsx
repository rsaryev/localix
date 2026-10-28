import { useState } from 'react'
import { SettingsControlRow, SettingsPage, SettingsSection } from './SettingsScaffold'
import { NotificationsSection } from './NotificationsSection'
import { ModBandSection } from './ModBandSection'
import { TypographySection } from './typography/TypographySection'
import { Input } from '@localixai/kit/input'
import { getSpendThreshold, setSpendThreshold } from '@/shared/lib/spendAlert'
import { ThemeField } from './ThemeField'
import { OutputStyleField } from './OutputStyleField'
import {
  DEFAULT_WINDOW_TRANSPARENCY,
  WINDOW_TRANSPARENCY_LABELS,
  WINDOW_TRANSPARENCY_LEVELS,
  setWindowTransparency,
  useWindowTransparency,
} from '@/shared/theme/windowTransparency'
import { Select, type SelectOption } from '@localixai/kit/select'
import { Slider } from '@localixai/kit/slider'
import {
  setRailRecentsMode,
  useRailRecentsMode,
  type RailRecentsMode,
} from '@/shared/lib/railRecentsPref'

// What each mode does is the option's own line, not a sentence beside the field that only ever
// described the CURRENT mode — so choosing meant picking one to find out what it did.
const RECENTS_MODE_OPTIONS: SelectOption[] = [
  {
    value: 'hover',
    label: 'Collapsed — reveal on hover',
    description: 'One rail slot however deep the history runs; it marks the view you have open.',
  },
  {
    value: 'expanded',
    label: 'Always expanded',
    description: 'Every remembered view takes its own slot in the rail.',
  },
  {
    value: 'off',
    label: 'Hidden',
    description: 'Still recorded — switch back to see them again.',
  },
]

function RailRecentsField() {
  const mode = useRailRecentsMode()
  return (
    <SettingsSection
      anchor="prefs-rail-recents"
      scope="device"
      title="Recent views"
      description="Choose how the last ten plugin views appear in the rail."
      actions={
        <Select
          size="xl"
          className="w-full @xl:w-64"
          contentClassName="w-80"
          value={mode}
          onValueChange={(next) => setRailRecentsMode(next as RailRecentsMode)}
          options={RECENTS_MODE_OPTIONS}
          aria-label="Recent views in the rail"
        />
      }
    />
  )
}

function SpendAlertField() {
  // Seed from the persisted threshold; empty string means "off".
  const [value, setValue] = useState(() => {
    const t = getSpendThreshold()
    return t > 0 ? String(t) : ''
  })
  const commit = (raw: string) => {
    setValue(raw)
    setSpendThreshold(Number.parseFloat(raw))
  }
  return (
    <SettingsSection
      anchor="prefs-spend-alert"
      scope="device"
      title="Spend alert"
      description="Warn when metered session spend crosses this amount. Subscription costs are excluded. Leave blank to turn alerts off."
      actions={
        <>
          <span className="text-sm text-text-soft">$</span>
          <Input
            size="xl"
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            value={value}
            onChange={(e) => commit(e.target.value)}
            placeholder="Off"
            aria-label="Spend alert threshold in US dollars"
            className="w-28"
          />
          <span className="text-xs text-text-soft">per session</span>
        </>
      }
    />
  )
}

function TransparencyField() {
  const level = useWindowTransparency()
  return (
    <SettingsControlRow
      title="Window transparency"
      description="How much of the desktop shows through the workspace. Menus and dialogs keep their frosted glass. Reduce transparency in the system settings makes the window opaque at any level."
    >
      <Slider
        aria-label="Window transparency"
        className="w-full @xl:w-56"
        steps={WINDOW_TRANSPARENCY_LEVELS.map((step) => WINDOW_TRANSPARENCY_LABELS[step])}
        value={WINDOW_TRANSPARENCY_LEVELS.indexOf(level)}
        onValueChange={(index) =>
          setWindowTransparency(WINDOW_TRANSPARENCY_LEVELS[index] ?? DEFAULT_WINDOW_TRANSPARENCY)
        }
      />
    </SettingsControlRow>
  )
}

export function PreferencesSettings() {
  return (
    <SettingsPage
      title="Preferences"
      description="Make the workspace comfortable for the way you work."
    >
      <SettingsSection
        anchor="prefs-typography"
        title="Appearance"
        description="Choose your theme, interface font, and code appearance."
      >
        <TypographySection
          leading={
            <>
              <ThemeField />
              <TransparencyField />
            </>
          }
        />
      </SettingsSection>

      <OutputStyleField />

      <RailRecentsField />

      <ModBandSection />

      <NotificationsSection />

      <SpendAlertField />
    </SettingsPage>
  )
}
