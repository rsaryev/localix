import { Select } from '@localixai/kit/select'

import { usePluginTheme, useScopeThemes } from '@/shared/theme/pluginTheme'
import { currentThemeValue, selectTheme, themeChoices } from '@/shared/theme/themeChoice'
import { useTheme } from '@/shared/theme/useTheme'
import { SettingsControlRow } from './SettingsScaffold'

export function ThemeField() {
  const { themeMode, resolvedTheme, setThemeMode } = useTheme()
  const chosen = usePluginTheme()
  // The open scope's themes, as `/theme` lists them: the global plugins' and the open project's.
  const themes = useScopeThemes()
  return (
    <SettingsControlRow
      title="Theme"
      description="Appearance on this device. System follows your operating system; a plugin's theme recolors Light or Dark. Also /theme in a chat."
    >
      <Select
        aria-label="Theme"
        size="xl"
        className="w-full @xl:w-44"
        contentClassName="w-64"
        value={currentThemeValue(chosen, themes, { themeMode, resolvedTheme })}
        onValueChange={(next) => selectTheme(next, themes, setThemeMode)}
        options={themeChoices(themes)}
      />
    </SettingsControlRow>
  )
}
