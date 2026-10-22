/**
 * A color theme (`themes/<slug>.json`): `{ name?, base?, overrides? }`, the custom theme file
 * Claude Code users write in `~/.claude/themes/`. The slug is the file name; `name` labels it and
 * defaults to the slug; `base` is the preset it starts from. Unknown tokens and invalid colors are
 * ignored, so a typo cannot break rendering.
 */
export interface ClaudeTheme {
  slug: string
  name: string
  base: ThemeBase
  /** Token → CSS color (`#rrggbb` or `rgb(…)`), the valid overrides only. */
  overrides: Record<string, string>
}

export const THEME_BASES = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
] as const
export type ThemeBase = (typeof THEME_BASES)[number]

/** The 16 standard ANSI colors, as xterm draws them. */
const ANSI: Record<string, string> = {
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  blackBright: '#7f7f7f',
  redBright: '#ff0000',
  greenBright: '#00ff00',
  yellowBright: '#ffff00',
  blueBright: '#5c5cff',
  magentaBright: '#ff00ff',
  cyanBright: '#00ffff',
  whiteBright: '#ffffff',
}
const ANSI_ORDER = Object.values(ANSI)

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/** The xterm 256-color palette entry `n` as `#rrggbb`. */
function ansi256(n: number): string {
  if (n < 16) return ANSI_ORDER[n]!
  if (n >= 232) {
    const level = 8 + (n - 232) * 10
    return `#${hex2(level)}${hex2(level)}${hex2(level)}`
  }
  const cube = n - 16
  const step = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  return `#${hex2(step(Math.floor(cube / 36)))}${hex2(step(Math.floor(cube / 6) % 6))}${hex2(step(cube % 6))}`
}

/**
 * A theme color as CSS, or null when it is not one Claude Code accepts: `#rrggbb`, `#rgb`,
 * `rgb(r,g,b)`, `ansi256(n)` or `ansi:<name>`.
 */
export function themeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(text))
    return `#${text.slice(1).replace(/./g, (c) => c + c)}`.toLowerCase()
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text)
  if (rgb) {
    const parts = rgb.slice(1).map(Number)
    return parts.every((part) => part <= 255) ? `#${parts.map(hex2).join('')}` : null
  }
  const indexed = /^ansi256\(\s*(\d{1,3})\s*\)$/i.exec(text)
  if (indexed) {
    const n = Number(indexed[1])
    return n <= 255 ? ansi256(n) : null
  }
  const named = /^ansi:(\w+)$/.exec(text)
  return named ? (ANSI[named[1]!] ?? null) : null
}

/** Read a theme file; null when it is not a JSON object. */
export function parseTheme(slug: string, raw: unknown): ClaudeTheme | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const base = (THEME_BASES as readonly unknown[]).includes(record.base)
    ? (record.base as ThemeBase)
    : 'dark'
  const overrides: Record<string, string> = {}
  if (record.overrides && typeof record.overrides === 'object')
    for (const [token, value] of Object.entries(record.overrides)) {
      const color = themeColor(value)
      if (color) overrides[token] = color
    }
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : slug
  return { slug, name, base, overrides }
}
