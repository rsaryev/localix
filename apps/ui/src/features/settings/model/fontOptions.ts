import type { UiSettings } from '@/shared/api/contracts'

export type FontFamily = NonNullable<UiSettings['fontFamily']>
export type CodeFont = NonNullable<UiSettings['codeFont']>
export type FontSize = NonNullable<UiSettings['fontSize']>

export interface FontOption<V extends string> {
  value: V
  label: string
  /** Short sample rendered inside the card. */
  sample: string
}

/**
 * THE font stacks — one owner, read by BOTH surfaces.
 *
 * `useFontFamily` applies these live (`--font-sans` / `--font-mono`) and the settings
 * typography card previews them through `codeFontCss`. They used to be two hand-kept
 * copies, and the copies had drifted: three of the four code fonts previewed a stack
 * with a DIFFERENT fallback chain than the one the editor actually installed, so the
 * moment a primary font failed to load the preview and the editor landed on different
 * typefaces — the picker showed you a font you would not get. A preview is a promise
 * about the live stack, so it must BE the live stack, not a restatement of it.
 *
 * Keyed by the OWNER's unions (`UiSettings['fontFamily' | 'codeFont']`), not by `string`:
 * a `Record<string, string>` is not a lookup table, it is a lookup table wearing the
 * costume of one — it cannot notice a typo'd key and it cannot notice a font added
 * upstream (the value just falls through to the default and the user silently gets the
 * wrong typeface). Under these annotations, adding a member to the settings enum fails
 * HERE, at the one place that has to know the CSS stack for it.
 */
export const UI_FONT_STACKS: Record<FontFamily, string> = {
  system: 'system-ui, -apple-system, sans-serif',
  inter: "'Inter Variable', system-ui, sans-serif",
  geist: "'Geist Variable', system-ui, sans-serif",
  'dm-sans': "'DM Sans Variable', system-ui, sans-serif",
  // Legacy mono-as-UI values — kept so previously-stored settings still resolve.
  'jetbrains-mono': "'JetBrains Mono Variable', monospace",
  'fira-code': "'Fira Code Variable', monospace",
}

export const CODE_FONT_STACKS: Record<CodeFont, string> = {
  'fragment-mono': "'Fragment Mono', ui-monospace, 'Cascadia Code', monospace",
  'jetbrains-mono': "'JetBrains Mono Variable', ui-monospace, monospace",
  'fira-code': "'Fira Code Variable', ui-monospace, monospace",
  'system-mono': "ui-monospace, Menlo, Monaco, 'Cascadia Code', Consolas, monospace",
}

/**
 * The typography picker catalogs — the SINGLE source of truth shared by the
 * Preferences settings panel and the onboarding Appearance step, so the two
 * surfaces can never drift. They carry PRESENTATION only (label + sample); the
 * CSS stack for a value comes from the maps above, so an option cannot restate
 * — and therefore cannot contradict — what the editor installs.
 */

/** Interface (sans) fonts — drive `--font-sans`. */
export const UI_FONT_OPTIONS: FontOption<
  Extract<FontFamily, 'system' | 'inter' | 'geist' | 'dm-sans'>
>[] = [
  { value: 'system', label: 'System', sample: 'The quick brown fox' },
  { value: 'inter', label: 'Inter', sample: 'The quick brown fox' },
  { value: 'geist', label: 'Geist', sample: 'The quick brown fox' },
  { value: 'dm-sans', label: 'DM Sans', sample: 'The quick brown fox' },
]

/** Editor / code (monospace) fonts — drive `--font-mono`. */
export const CODE_FONT_OPTIONS: FontOption<CodeFont>[] = [
  { value: 'fragment-mono', label: 'Fragment Mono', sample: 'const fn = (x) => x' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', sample: 'const fn = (x) => x' },
  { value: 'fira-code', label: 'Fira Code', sample: 'const fn = (x) => x' },
  { value: 'system-mono', label: 'System mono', sample: 'const fn = (x) => x' },
]

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string; size: string }[] = [
  { value: 'sm', label: 'Small', size: '13px' },
  { value: 'md', label: 'Medium', size: '14px' },
  { value: 'lg', label: 'Large', size: '15px' },
  { value: 'xl', label: 'Extra large', size: '16px' },
]

/** The default applied when no code font is stored — used by the preview AND the live stack. */
export const DEFAULT_CODE_FONT: CodeFont = 'fragment-mono'

/** Resolve a code font value to the CSS stack the editor will actually install. */
export function codeFontCss(value: CodeFont | undefined): string {
  return CODE_FONT_STACKS[value ?? DEFAULT_CODE_FONT] ?? CODE_FONT_STACKS[DEFAULT_CODE_FONT]
}
export function fontSizePx(value: FontSize | undefined): string {
  return FONT_SIZE_OPTIONS.find((o) => o.value === value)?.size ?? '14px'
}
