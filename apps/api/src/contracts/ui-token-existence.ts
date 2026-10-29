/**
 * A class that NAMES a kit token must name one that exists.
 *
 * The defect: Tailwind v4 resolves `bg-surface-subtle` by looking up `--color-surface-subtle`, and
 * when the theme has no such name it emits NOTHING — no error, no warning, no rule. The element
 * simply paints nothing, and it looks deliberate. Eleven such classes shipped (`bg-surface`,
 * `text-text-muted`, `text-status-danger`, `text-text`, …), each a plausible spelling of a token the
 * author half-remembered, and none was caught by type-checking, the build or a review. The same
 * holds for radius: `rounded-xs` is not on the kit's `--radius` scale, so it falls through to
 * Tailwind's stock `0.125rem` and ignores every retune of `--radius`.
 *
 * So the check is against the theme itself, not a list copied from it: {@link themeTokensOf} reads
 * the `--color-*` and `--radius-*` names a stylesheet's `@theme` blocks declare, and
 * {@link missingTokens} flags a class of a family the kit owns whose name is not among them. Only
 * the families the kit owns are judged (`surface`, `text`, `status`, …) — Tailwind's own palette is
 * the token-drift rules' business — and Tailwind's stock layer (`@theme default`) does not count
 * as defining a token, because falling through to it is the defect.
 *
 * Two readers, like `ui-token-rules.ts`: the repository guard reads the kit's source stylesheet,
 * and the authoring plugin's style step reads the copy staged in the mini app kit. Browser-safe and
 * dependency-free.
 */

export interface ThemeTokens {
  /** `--color-<name>` names, without the prefix: `surface-hover`, `text-soft`. */
  readonly colors: ReadonlySet<string>
  /** `--radius-<name>` names, without the prefix: `sm`, `md`. */
  readonly radii: ReadonlySet<string>
}

export interface MissingToken {
  readonly index: number
  /** The class as written, alpha and all. */
  readonly match: string
  readonly kind: 'color' | 'radius'
  /** The token the class asks for: `surface-subtle`, `xs`. */
  readonly token: string
  readonly fix: string
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//gu
const THEME_OPEN = /@theme\b([^{;]*)\{/gu
const THEME_NAME = /--(color|radius)-([a-z0-9-]+)\s*:/gu

/** Declared `--color-*` / `--radius-*` names of every non-stock `@theme` block in `css`. */
export function themeTokensOf(...stylesheets: readonly string[]): ThemeTokens {
  const colors = new Set<string>()
  const radii = new Set<string>()
  for (const raw of stylesheets) {
    const css = raw.replace(CSS_COMMENT, '')
    for (const open of css.matchAll(THEME_OPEN)) {
      // `@theme default` is Tailwind's stock layer: a class resolving there is the fall-through.
      if (/\bdefault\b/u.test(open[1] ?? '')) continue
      const start = (open.index ?? 0) + open[0].length
      let depth = 1
      let end = start
      for (; end < css.length && depth > 0; end++) {
        if (css[end] === '{') depth++
        else if (css[end] === '}') depth--
      }
      for (const name of css.slice(start, end).matchAll(THEME_NAME)) {
        ;(name[1] === 'color' ? colors : radii).add(name[2] as string)
      }
    }
  }
  return { colors, radii }
}

const COLOR_UTILITIES =
  'bg|text|border(?:-[trblxyse])?|ring|fill|stroke|outline|divide|from|via|to|decoration|caret|accent|placeholder'
/**
 * The colour families the kit owns; a class naming one of these must name a kit token. The
 * shadcn-shaped names are the kit's too (`destructive-foreground` was the twelfth absent class) —
 * Tailwind's stock palette shares none of these words, so none of them can resolve there.
 */
const KIT_FAMILIES =
  'surface|text|status|conn|chart|field|control|popover|sidebar|card|border|background|foreground|primary|secondary|muted|accent|destructive|input|ring|composer'
// A class never follows `/` or `.`; a module path does (`./text-input-completion-port`).
const COLOR_CLASS = new RegExp(
  `(?<![\\w/.-])(?:${COLOR_UTILITIES})-((?:${KIT_FAMILIES})[-a-z0-9]*)(?:\\/(?:\\d+|\\[[^\\]\\s]+\\]))?(?![\\w-])`,
  'gu',
)
const RADIUS_SIDE = 't|r|b|l|tl|tr|bl|br|s|e|ss|se|es|ee'
const RADIUS_CLASS = new RegExp(
  `(?<![\\w-])rounded(?:-(?:${RADIUS_SIDE}))?-([a-z0-9]+)(?![\\w-])`,
  'gu',
)
/** Static radius utilities that are not tokens, and a bare side (`rounded-t`), which is no name. */
const RADIUS_NOT_A_TOKEN = new Set(['none', 'full', ...RADIUS_SIDE.split('|')])

export const MISSING_COLOR_FIX =
  'name a kit token: text-foreground / text-text-strong|soft|faint, bg-foreground/[0.04], bg-field-fill, bg-surface-hover|active|sunken, bg-card, bg-popover, text-status-error|warning|success|info'
export const MISSING_RADIUS_FIX =
  'use the radius scale: rounded-xs / sm / md / lg / xl / 2xl / full'

/** Each class in `code` that names a kit-family colour or a radius the theme does not define. */
export function missingTokens(code: string, tokens: ThemeTokens): MissingToken[] {
  const found: MissingToken[] = []
  for (const match of code.matchAll(COLOR_CLASS)) {
    const token = match[1] as string
    if (tokens.colors.has(token)) continue
    found.push({
      index: match.index ?? 0,
      match: match[0],
      kind: 'color',
      token,
      fix: MISSING_COLOR_FIX,
    })
  }
  for (const match of code.matchAll(RADIUS_CLASS)) {
    const token = match[1] as string
    if (tokens.radii.has(token) || RADIUS_NOT_A_TOKEN.has(token)) continue
    found.push({
      index: match.index ?? 0,
      match: match[0],
      kind: 'radius',
      token,
      fix: MISSING_RADIUS_FIX,
    })
  }
  return found.sort((a, b) => a.index - b.index)
}
