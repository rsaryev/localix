import type { ReactNode } from 'react'
import { Select } from '@localixai/kit/select'
import { useUserSettings } from '../../model/useUserSettings'
import {
  CODE_FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  UI_FONT_OPTIONS,
  codeFontCss,
  fontSizePx,
} from '../../model/fontOptions'
import type { CodeFont, FontFamily, FontSize } from '../../model/fontOptions'
import { EditorFontPreview } from './EditorFontPreview'
import { SettingsRow, SettingsRows } from '../SettingsScaffold'

/** One label-left / control-right row inside the typography settings group. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <SettingsRow className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="truncate text-2xs text-text-soft">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </SettingsRow>
  )
}

/**
 * The typography block — a LIVE syntax-highlighted editor preview on top, then a
 * clean row registry (UI font · code font · size) like a native settings
 * panel. Owns its own settings reads/writes (live-merged so quick consecutive
 * field changes can't clobber each other), so both the Preferences panel and the
 * onboarding Appearance step drop it in as one self-contained unit.
 */
export function TypographySection() {
  const { settings } = useUserSettings()
  const ui = settings.uiSettings
  const currentUi = (ui?.fontFamily ?? 'system') as FontFamily
  const currentCode = (ui?.codeFont ?? 'fragment-mono') as CodeFont
  const currentSize = (ui?.fontSize ?? 'md') as FontSize

  const patch = (next: Partial<NonNullable<typeof ui>>) => {
    const base = useUserSettings.getState().settings.uiSettings ?? {}
    useUserSettings.getState().update({ uiSettings: { ...base, ...next } })
  }

  const selectCls = 'w-44'

  return (
    <div className="w-full space-y-3 text-left">
      {/* Live editor preview — code font + size, exactly as the editor renders. */}
      <EditorFontPreview fontCss={codeFontCss(currentCode)} fontSize={fontSizePx(currentSize)} />

      <SettingsRows>
        <Row label="Interface font" hint="Buttons, menus, and body text">
          <Select
            className={selectCls}
            value={currentUi}
            onValueChange={(v) => patch({ fontFamily: v as FontFamily })}
            aria-label="Interface font"
            options={UI_FONT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Row>
        <Row label="Code font" hint="The editor and all code blocks">
          <Select
            className={selectCls}
            value={currentCode}
            onValueChange={(v) => patch({ codeFont: v as CodeFont })}
            aria-label="Code font"
            options={CODE_FONT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Row>
        <Row label="Font size" hint="Base interface text size">
          <Select
            className={selectCls}
            value={currentSize}
            onValueChange={(v) => patch({ fontSize: v as FontSize })}
            aria-label="Font size"
            options={FONT_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Row>
      </SettingsRows>
    </div>
  )
}
