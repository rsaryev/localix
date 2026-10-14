import { useEffect } from 'react'
import { codeFontSize, setRootFontPx } from '@localixai/kit/lib'
import type { FontSize } from './fontOptions'
import { CODE_FONT_STACKS, DEFAULT_CODE_FONT, UI_FONT_STACKS } from './fontOptions'
import { useSettingsStore } from './settingsStore'

// The font stacks live in ./fontOptions — ONE owner, shared with the settings preview.
// Restating them here is what let the picker advertise a fallback chain the editor did
// not install; see the contract note on CODE_FONT_STACKS.

const FONT_SIZE_MAP: Record<FontSize, string> = {
  sm: '13px',
  md: '14px',
  lg: '15px',
  xl: '16px',
}

export function useFontFamily() {
  // Raw preference — NO default. When unset we must NOT write an inline
  // `--font-sans`/`--font-mono` on <html>: an inline custom property beats every
  // stylesheet rule, which would permanently override the web brand default
  // (Inter Variable) AND the desktop per-OS native stacks in index.css.
  const fontFamily = useSettingsStore((s) => s.settings.uiSettings?.fontFamily)
  const codeFont = useSettingsStore((s) => s.settings.uiSettings?.codeFont)
  const fontSize = useSettingsStore((s) => s.settings.uiSettings?.fontSize ?? 'md')

  useEffect(() => {
    if (!fontFamily) {
      document.documentElement.style.removeProperty('--font-sans')
      return
    }
    const css = UI_FONT_STACKS[fontFamily] ?? UI_FONT_STACKS.system
    document.documentElement.style.setProperty('--font-sans', css)
  }, [fontFamily])

  useEffect(() => {
    if (!codeFont) {
      document.documentElement.style.removeProperty('--font-mono')
      return
    }
    const css = CODE_FONT_STACKS[codeFont] ?? CODE_FONT_STACKS[DEFAULT_CODE_FONT]
    document.documentElement.style.setProperty('--font-mono', css)
  }, [codeFont])

  useEffect(() => {
    const size = FONT_SIZE_MAP[fontSize] ?? FONT_SIZE_MAP.md
    document.documentElement.style.fontSize = size
    // Monaco lays text out in pixels, so expose the matching scaled editor size.
    const rootPx = Number.parseFloat(size)
    setRootFontPx(rootPx)
    document.documentElement.style.setProperty('--editor-font-size', `${codeFontSize()}px`)
  }, [fontSize])
}
