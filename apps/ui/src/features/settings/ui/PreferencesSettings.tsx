import { useState } from 'react'
import { SettingsPage, SettingsSection, SettingsSurface } from './SettingsScaffold'
import { Button } from '@localixai/kit/button'
import { useNavigate } from 'react-router'
import { setupPath } from '@/shared/routing/routes'
import { TypographySection } from './typography/TypographySection'
import { Input } from '@localixai/kit/input'
import { getSpendThreshold, setSpendThreshold } from '@/shared/lib/spendAlert'
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
    <SettingsSurface className="flex items-center gap-3">
      <Select
        className="w-64"
        contentClassName="w-80"
        value={mode}
        onValueChange={(next) => setRailRecentsMode(next as RailRecentsMode)}
        options={RECENTS_MODE_OPTIONS}
        aria-label="Recent views in the rail"
      />
    </SettingsSurface>
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
    <SettingsSurface className="flex items-center gap-2">
      <span className="text-sm text-text-soft">$</span>
      <Input
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
      <span className="text-sm text-text-faint">per session</span>
    </SettingsSurface>
  )
}

export function PreferencesSettings() {
  const navigate = useNavigate()
  return (
    <SettingsPage
      title="Preferences"
      description="Typography, rail, and budget defaults for the interface."
    >
      {/* Appearance is not a setting on this page any more: the app ships dark, light and system,
          and the rail's own button cycles them in place. A settings row that opened a picker for
          three values was a page for something one visible click answers. */}
      <SettingsSection
        anchor="prefs-typography"
        title="Typography"
        description="Interface and editor fonts plus text size — the preview shows your code font exactly as the editor renders it."
      >
        <TypographySection />
      </SettingsSection>

      <SettingsSection
        anchor="prefs-setup"
        title="Setup"
        description="Re-run the short provider and default-model setup."
      >
        <Button
          variant="outline"
          size="xl"
          onClick={() => {
            void navigate(setupPath())
          }}
        >
          Replay setup
        </Button>
      </SettingsSection>

      <SettingsSection
        anchor="prefs-rail-recents"
        title="Recent views"
        description="Plugin views you open are remembered by the navigation rail. Keep the last ten behind one button so the rail stays quiet, show them all, or turn the slots off."
      >
        <RailRecentsField />
      </SettingsSection>

      <SettingsSection
        anchor="prefs-spend-alert"
        title="Spend alert"
        description="Warn above the composer once a session's metered spend crosses this budget. The strip re-appears at each further multiple and can be dismissed; leave blank to turn it off. Subscription (plan-estimate) cost is never alerted."
      >
        <SpendAlertField />
      </SettingsSection>
    </SettingsPage>
  )
}
