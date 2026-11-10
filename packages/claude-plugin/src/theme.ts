/**
 * A color theme (`themes/<slug>.json`): `{ name?, base?, overrides? }`, the custom theme file
 * Claude Code users write in `~/.claude/themes/`. The slug is the file name; `name` labels it and
 * defaults to the slug; `base` is the preset it starts from. The kit reads the file; this is the
 * shape Localix's theme screens take.
 */
export interface ClaudeTheme {
  slug: string
  name: string
  base: ThemeBase
  /** Token → CSS color (`#rrggbb` or `rgb(…)`), the valid overrides only. */
  overrides: Record<string, string>
}

const THEME_BASES = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
] as const
export type ThemeBase = (typeof THEME_BASES)[number]
