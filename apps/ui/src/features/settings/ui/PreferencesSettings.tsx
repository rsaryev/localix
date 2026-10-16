import { useState } from 'react'
import { SettingsControlRow, SettingsPage, SettingsSection } from './SettingsScaffold'
import { NotificationsSection } from './NotificationsSection'
import { IslandSection } from './IslandSection'
import { TypographySection } from './typography/TypographySection'
import { Input } from '@localixai/kit/input'
import { getSpendThreshold, setSpendThreshold } from '@/shared/lib/spendAlert'
import { useTheme, type ThemeMode } from '@/shared/theme/useTheme'
import { Select, type SelectOption } from '@localixai/kit/select'
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

function ThemeField() {
  const { themeMode, setThemeMode } = useTheme()
  return (
    <SettingsControlRow
      title="Theme"
      description="Appearance on this device. System follows your operating system."
    >
      <Select
        aria-label="Theme"
        size="xl"
        className="w-full @xl:w-44"
        value={themeMode}
        onValueChange={(value) => setThemeMode(value as ThemeMode)}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
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
        <TypographySection leading={<ThemeField />} />
      </SettingsSection>

      <RailRecentsField />

      <NotificationsSection />

      <IslandSection />

      <SpendAlertField />
    </SettingsPage>
  )
}
