import { createContext, type CSSProperties } from 'react'

/**
 * How Claude Code's layout, text and control props read on a Localix screen — one table for every
 * mod, chosen by the SITE it draws on, never by which mod drew it. A mod is written for a terminal:
 * a cell of spacing, a named colour, a bold heading. Here each becomes a step of the app's own
 * scale at the site's density, so any mod looks like the rest of the app and two mods look alike.
 *
 * - `band`: the strip above the message box, at the composer strips' density — 12px text, 11px
 *   meta, the 20px control rung, a 4px/2px cell.
 * - `pane`: a mod's pane tab, at workbench density — 13px text, 12px meta, the 24px rung, a
 *   6px/4px cell.
 *
 * The table is documented for mod authors in `docs/extending/claude-code-mods.md`.
 */

export type ModSite = 'band' | 'pane'

/** The site a tree is drawn on: the band above the message box, or a pane. */
export const ModSiteContext = createContext<ModSite>('pane')

interface Density {
  /** One terminal cell of spacing across and down, in px. */
  cell: { x: number; y: number }
  /** The most spacing a cell count may come to: an 80-column layout's indents stay small. */
  maxSpace: number
  /** The kit spacing steps the named steps (`xs`…`xl`) map onto, in px. */
  steps: Record<string, number>
  /** The text tiers: `meta` under `text`, `heading` and `title` over it. */
  tiers: Record<TextTier, string>
  /** What `bold` comes to: never heavier than the site's own titles. */
  bold: 'medium' | 'semibold'
  control: 'xs' | 'sm'
  field: 'md'
}

export type TextTier = 'meta' | 'text' | 'heading' | 'title'

export const DENSITY: Record<ModSite, Density> = {
  band: {
    cell: { x: 4, y: 2 },
    maxSpace: 12,
    steps: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12 },
    tiers: { meta: 'text-2xs', text: 'text-xs', heading: 'text-xs', title: 'text-xs' },
    bold: 'medium',
    control: 'xs',
    field: 'md',
  },
  pane: {
    cell: { x: 6, y: 4 },
    maxSpace: 24,
    steps: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 },
    tiers: { meta: 'text-xs', text: 'text-sm', heading: 'text-sm', title: 'text-base' },
    bold: 'semibold',
    control: 'sm',
    field: 'md',
  },
}

/** A spacing prop: cells at the site's step, clamped; a step name as the kit's step; else none. */
export function space(value: unknown, site: ModSite, axis: 'x' | 'y'): string | undefined {
  const density = DENSITY[site]
  if (typeof value === 'number' && Number.isFinite(value))
    return `${Math.min(Math.max(0, value) * density.cell[axis], density.maxSpace)}px`
  if (typeof value === 'string' && value in density.steps) return `${density.steps[value]}px`
  return undefined
}

const isPercent = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)

/**
 * A size in cells: across, a character of the site's own text (`ch`), so a column a mod sized for
 * its text still holds that text; down, a line of it. A percentage is kept.
 */
const cells = (value: unknown, unit: 'ch' | 'lh'): string | undefined =>
  typeof value === 'number'
    ? unit === 'ch'
      ? `${value}ch`
      : `${value * 1.5}em`
    : isPercent(value)
      ? value
      : undefined

/** The fixed palette: a terminal colour name as the theme token that means it in either theme. */
const NAMED: Record<string, string> = {
  red: 'var(--status-error)',
  green: 'var(--status-success)',
  yellow: 'var(--status-warning)',
  blue: 'var(--status-info)',
  cyan: 'var(--chart-2)',
  magenta: 'var(--conn-violet)',
  gray: 'var(--text-faint)',
  grey: 'var(--text-faint)',
  white: 'var(--foreground)',
  black: 'var(--background)',
}

function rgbOf(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? hex.slice(0, 3).replace(/./g, (c) => c + c) : hex
    return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ]
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** An exact colour, as the palette entry nearest its hue; greys as the foreground or faint text. */
function nearestToken([r, g, b]: [number, number, number]): string {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const lightness = (max + min) / 2
  const chroma = max - min
  if (chroma < 0.15) return lightness > 0.7 ? NAMED.white! : NAMED.gray!
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const hue =
    max === rn
      ? (60 * ((gn - bn) / chroma) + 360) % 360
      : max === gn
        ? 60 * ((bn - rn) / chroma) + 120
        : 60 * ((rn - gn) / chroma) + 240
  if (hue < 20 || hue >= 330) return NAMED.red!
  if (hue < 70) return NAMED.yellow!
  if (hue < 170) return NAMED.green!
  if (hue < 195) return NAMED.cyan!
  if (hue < 255) return NAMED.blue!
  return NAMED.magenta!
}

/** A colour a mod named, as a theme token: a terminal name (its `Bright` twin too), a hex or rgb. */
export function colorOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/Bright$/, '')
  if (name in NAMED) return NAMED[name]
  const rgb = rgbOf(value)
  return rgb ? nearestToken(rgb) : undefined
}

/** A colour as a ground: the same token, as a soft tint of whatever is under it. */
const tintOf = (value: unknown): string | undefined => {
  const color = colorOf(value)
  return color ? `color-mix(in oklab, ${color} 14%, transparent)` : undefined
}

/** In the band a colour is an accent at strip contrast, not a loud heading. */
const muted = (color: string | undefined, site: ModSite) =>
  color && site === 'band' ? `color-mix(in oklab, ${color} 70%, var(--text-soft))` : color

const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const
const AXIS = { Top: 'y', Bottom: 'y', Left: 'x', Right: 'x' } as const

/** Claude Code's border styles: a hairline, a stronger line for `bold`/`double`, or a quote bar. */
const FRAMES: Record<string, 'hairline' | 'strong'> = {
  single: 'hairline',
  round: 'hairline',
  classic: 'hairline',
  arrow: 'hairline',
  dashed: 'hairline',
  singleDouble: 'hairline',
  doubleSingle: 'hairline',
  bold: 'strong',
  double: 'strong',
}

export interface BoxLook {
  style: CSSProperties
  framed: 'hairline' | 'strong' | 'quote' | null
}

export function boxLook(props: Record<string, unknown>, site: ModSite): BoxLook {
  const style: CSSProperties = {
    display: props.display === 'none' ? 'none' : 'flex',
    flexDirection: props.flexDirection === 'column' ? 'column' : 'row',
    flexWrap: props.flexWrap === 'wrap' ? 'wrap' : undefined,
    alignItems: typeof props.alignItems === 'string' ? props.alignItems : undefined,
    alignSelf: typeof props.alignSelf === 'string' ? props.alignSelf : undefined,
    justifyContent: typeof props.justifyContent === 'string' ? props.justifyContent : undefined,
    columnGap: space(props.columnGap ?? props.gap, site, 'x'),
    rowGap: space(props.rowGap ?? props.gap, site, 'y'),
    paddingInline: space(props.paddingX ?? props.padding, site, 'x'),
    paddingBlock: space(props.paddingY ?? props.padding, site, 'y'),
    marginInline: space(props.marginX ?? props.margin, site, 'x'),
    marginBlock: space(props.marginY ?? props.margin, site, 'y'),
    flexGrow: typeof props.flexGrow === 'number' ? props.flexGrow : undefined,
    flexShrink: typeof props.flexShrink === 'number' ? props.flexShrink : undefined,
    width: cells(props.width, 'ch'),
    minWidth: cells(props.minWidth, 'ch') ?? 0,
    maxWidth: '100%',
    height: cells(props.height, 'lh'),
    minHeight: cells(props.minHeight, 'lh'),
    overflow: props.overflow === 'hidden' ? 'hidden' : undefined,
    backgroundColor: tintOf(props.backgroundColor),
    // A coloured frame stays a hairline: a hint of the colour in the faint border.
    borderColor: colorOf(props.borderColor)
      ? `color-mix(in oklab, ${colorOf(props.borderColor)} 35%, var(--color-border-faint))`
      : undefined,
  }
  for (const side of SIDES) {
    const padding = space(props[`padding${side}`], site, AXIS[side])
    const margin = space(props[`margin${side}`], site, AXIS[side])
    if (padding !== undefined) style[`padding${side}`] = padding
    if (margin !== undefined) style[`margin${side}`] = margin
  }
  const border = typeof props.borderStyle === 'string' ? props.borderStyle : ''
  return { style, framed: border === 'quote' ? 'quote' : (FRAMES[border] ?? null) }
}

const TIER_OF_SIZE: Record<string, TextTier> = {
  caption: 'meta',
  footnote: 'meta',
  body: 'text',
  heading: 'heading',
  title: 'title',
}

export interface TextLook {
  tier: TextTier | null
  weight: 'medium' | 'semibold' | null
  tone: 'soft' | null
  italic: boolean
  underline: boolean
  strikethrough: boolean
  mono: boolean
  tabular: boolean
  /** `inverse`: a chip in the colour, not a block of reversed video. */
  chip: boolean
  truncate: boolean
  style: CSSProperties
}

/** A `Text`'s look at the site: its tier, weight, tone and colours. */
export function textLook(props: Record<string, unknown>, site: ModSite): TextLook {
  const density = DENSITY[site]
  const size = typeof props.size === 'string' ? TIER_OF_SIZE[props.size] : undefined
  const bold =
    props.weight === 'semibold' || props.weight === 'bold' || (props.bold === true && !props.weight)
  const color = colorOf(props.color)
  const chip = props.inverse === true
  const truncate = typeof props.wrap === 'string' && props.wrap.startsWith('truncate')
  const style: CSSProperties = chip
    ? {
        color: color ?? 'var(--foreground)',
        backgroundColor: color
          ? `color-mix(in oklab, ${color} 18%, transparent)`
          : 'var(--surface-active)',
      }
    : { color: muted(color, site), backgroundColor: tintOf(props.backgroundColor) }
  // A terminal keeps every space a mod draws (`'  1% of context'` beside a word): so does this.
  style.whiteSpace = truncate ? 'pre' : 'pre-wrap'
  if (props.wrap === 'truncate-start') style.direction = 'rtl'
  return {
    tier: size ?? null,
    weight: bold ? density.bold : props.weight === 'medium' ? 'medium' : null,
    tone: props.dimColor === true && !color ? 'soft' : null,
    italic: props.italic === true,
    underline: props.underline === true,
    strikethrough: props.strikethrough === true,
    mono: props.mono === true,
    tabular: props.tabular === true,
    chip,
    truncate,
    style: props.dimColor === true && color ? { ...style, opacity: 0.7 } : style,
  }
}

export interface ButtonLook {
  size: 'xs' | 'sm'
  variant: 'field' | 'ghost' | 'mono' | 'destructive'
  /** A `plain` button: a quiet full-width row, as a menu row, not a raised control. */
  row: boolean
  quiet: boolean
}

export function buttonLook(props: Record<string, unknown>, site: ModSite): ButtonLook {
  const row = props.plain === true
  return {
    size: DENSITY[site].control,
    variant:
      props.variant === 'primary'
        ? 'mono'
        : props.variant === 'danger' || props.variant === 'destructive'
          ? 'destructive'
          : row
            ? 'ghost'
            : 'field',
    row,
    quiet: props.dimColor === true,
  }
}
