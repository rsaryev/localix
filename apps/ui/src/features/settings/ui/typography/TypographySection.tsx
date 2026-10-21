import type { ReactNode } from 'react'
import { Select } from '@localixai/kit/select'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import {
  CODE_FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  UI_FONT_OPTIONS,
  codeFontCss,
  fontSizePx,
} from '../../model/fontOptions'
import type { CodeFont, FontFamily, FontSize } from '../../model/fontOptions'
import { EditorFontPreview } from './EditorFontPreview'
import { SettingsControlRow, SettingsRows } from '../SettingsScaffold'

/**
 * The typography block — a LIVE syntax-highlighted editor preview on top, then a
 * clean row registry (UI font · code font · size) like a native settings
 * panel. Owns its own settings reads/writes (live-merged so quick consecutive
 * field changes can't clobber each other), so both the Preferences panel and the
 * onboarding Appearance step drop it in as one self-contained unit.
 */
export function TypographySection({ leading }: { leading?: ReactNode } = {}) {
  const { settings } = useUserSettings()
  const ui = settings.uiSettings
  const currentUi = (ui?.fontFamily ?? 'system') as FontFamily
  const currentCode = (ui?.codeFont ?? 'fragment-mono') as CodeFont
  const currentSize = (ui?.fontSize ?? 'md') as FontSize

  const patch = (next: Partial<NonNullable<typeof ui>>) => {
    const base = useUserSettings.getState().settings.uiSettings ?? {}
    useUserSettings.getState().update({ uiSettings: { ...base, ...next } })
  }

  const selectCls = 'w-full @xl:w-44'

  return (
    <div className="w-full space-y-3 text-left">
      <SettingsRows>
        {leading}
        <SettingsControlRow title="Interface font" description="Buttons, menus, and body text">
          <Select
            size="xl"
            className={selectCls}
            value={currentUi}
            onValueChange={(v) => patch({ fontFamily: v as FontFamily })}
            aria-label="Interface font"
            options={UI_FONT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </SettingsControlRow>
        <SettingsControlRow title="Code font" description="The editor and all code blocks">
          <Select
            size="xl"
            className={selectCls}
            value={currentCode}
            onValueChange={(v) => patch({ codeFont: v as CodeFont })}
            aria-label="Code font"
            options={CODE_FONT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </SettingsControlRow>
        <SettingsControlRow title="Font size" description="Base interface text size">
          <Select
            size="xl"
            className={selectCls}
            value={currentSize}
            onValueChange={(v) => patch({ fontSize: v as FontSize })}
            aria-label="Font size"
            options={FONT_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </SettingsControlRow>
      </SettingsRows>
      {/* Live editor preview — code font + size, exactly as the editor renders. */}
      <EditorFontPreview fontCss={codeFontCss(currentCode)} fontSize={fontSizePx(currentSize)} />
    </div>
  )
}
