import type { CSSProperties } from 'react'
import { borderColorOf, fillOf, INVERSE, textColorOf } from './modColor'
import type { ModSite } from './modSite'

export type { ModSite } from './modSite'

/**
 * How Claude Code's layout, text and control props read on a Localix screen — one table for every
 * mod, chosen by the SITE it draws on, never by which mod drew it. A mod is written for a terminal:
 * a cell of spacing, a named colour, a bold heading. Here each becomes a step of the app's own
 * scale at the site's density, so any mod looks like the rest of the app and two mods look alike.
 *
 * - `band`: the strip above the message box, at the composer strips' density — chrome, so the UI
 *   face: 12px text, 11px meta, the 20px control rung, a 4px/2px cell.
 * - `pane`: a mod's pane tab, at workbench density — a terminal's text on its grid, so the code
 *   face at the diff view's 12px (columns, diffs and ASCII line up), headings in the UI face; the
 *   24px rung, a 6px/4px cell.
 *
 * Colours are `modColor.ts`; how a pane and the band lay a tree out by its shape are
 * `paneLayout.ts` and `bandLayout.ts`.
 *
 * The table is documented for mod authors in `docs/extending/claude-code-mods.md`.
 */

interface Density {
  /** One terminal cell of spacing across and down, in px. */
  cell: { x: number; y: number }
  /** The most spacing a cell count may come to: an 80-column layout's indents stay small. */
  maxSpace: number
  /** The kit spacing steps the named steps (`xs`…`xl`) map onto, in px. */
  steps: Record<string, number>
  /** The text tiers: `meta` under `text`, `heading` and `title` over it. */
  tiers: Record<TextTier, string>
  /** What an explicit `weight: 'bold'` comes to: never heavier than the site's own titles. */
  bold: 'medium' | 'semibold'
  /** Whether plain text takes the code face: a pane is a terminal's grid, the band is chrome. */
  mono: boolean
  /** What `dimColor` text comes to: one step quieter than the site's own text. */
  dim: 'soft' | 'faint'
  control: 'xs' | 'sm'
  field: 'md'
}

export type TextTier = 'meta' | 'text' | 'heading' | 'title'

export const DENSITY: Record<ModSite, Density> = {
  band: {
    cell: { x: 4, y: 2 },
    maxSpace: 12,
    steps: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12 },
    tiers: { meta: 'text-2xs', text: 'text-2xs', heading: 'text-2xs', title: 'text-2xs' },
    bold: 'medium',
    mono: false,
    dim: 'faint',
    control: 'xs',
    field: 'md',
  },
  pane: {
    cell: { x: 6, y: 4 },
    maxSpace: 24,
    steps: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 },
    tiers: { meta: 'text-2xs', text: 'text-xs', heading: 'text-sm', title: 'text-base' },
    bold: 'semibold',
    mono: true,
    dim: 'soft',
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
    // A terminal row is one line of cells: unless the mod says otherwise, a text and a button in
    // it share their baseline instead of the text riding at the top of the button's box.
    alignItems:
      typeof props.alignItems === 'string'
        ? props.alignItems
        : props.flexDirection === 'column'
          ? undefined
          : 'baseline',
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
    backgroundColor: fillOf(props.backgroundColor, 'box'),
    borderColor: borderColorOf(props.borderColor),
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
  tone: 'soft' | 'faint' | null
  italic: boolean
  underline: boolean
  strikethrough: boolean
  mono: boolean
  tabular: boolean
  /** `inverse`: the selected segment, not a block of reversed video. */
  chip: boolean
  truncate: boolean
  style: CSSProperties
}

/** A `Text`'s look at the site: its tier, face, weight, tone and colours. */
export function textLook(props: Record<string, unknown>, site: ModSite): TextLook {
  const density = DENSITY[site]
  const size = typeof props.size === 'string' ? TIER_OF_SIZE[props.size] : undefined
  const dim = props.dimColor === true
  const color = textColorOf(props.color, site, dim)
  const chip = props.inverse === true
  const truncate = typeof props.wrap === 'string' && props.wrap.startsWith('truncate')
  const style: CSSProperties = chip
    ? { ...INVERSE }
    : { color, backgroundColor: fillOf(props.backgroundColor, 'text') }
  // A terminal keeps every space a mod draws (`'  1% of context'` beside a word): so does this.
  style.whiteSpace = truncate ? 'pre' : 'pre-wrap'
  // Truncated at its start, the ellipsis leads; the text still sits where a line starts.
  if (props.wrap === 'truncate-start') Object.assign(style, { direction: 'rtl', textAlign: 'left' })
  // `bold` is emphasis, drawn medium as the app's own labels are; only an explicit heavy weight
  // reaches the site's heading weight.
  const heavy = props.weight === 'semibold' || props.weight === 'bold'
  const medium = props.weight === 'medium' || (props.bold === true && !props.weight)
  return {
    tier: size ?? null,
    weight: heavy ? density.bold : medium ? 'medium' : null,
    tone: dim && !color && !chip ? density.dim : null,
    italic: props.italic === true,
    underline: props.underline === true,
    strikethrough: props.strikethrough === true,
    // A heading is the UI's own type; a line of the mod's text keeps its grid.
    mono: props.mono === true || (density.mono && size !== 'heading' && size !== 'title'),
    tabular: props.tabular === true,
    chip,
    truncate,
    style,
  }
}

export interface ButtonLook {
  size: 'xs' | 'sm'
  variant: 'ghost' | 'secondary' | 'mono' | 'destructive'
  /** A `plain` button in a list: a quiet full-width row, as a menu row, not a raised control. */
  row: boolean
  quiet: boolean
}

/**
 * One button style per site: in the band the composer strips' ghost action (`UpdateStrip`'s
 * Restart to update), in a pane the soft field fill a workbench action rests on. `inBar`: the
 * button is one of a pane's action bar, where a `plain` one is a button like its neighbours.
 */
export function buttonLook(
  props: Record<string, unknown>,
  site: ModSite,
  inBar = false,
): ButtonLook {
  const row = props.plain === true && !inBar
  return {
    size: DENSITY[site].control,
    variant:
      props.variant === 'primary'
        ? 'mono'
        : props.variant === 'danger' || props.variant === 'destructive'
          ? 'destructive'
          : row || site === 'band'
            ? 'ghost'
            : 'secondary',
    row,
    quiet: props.dimColor === true,
  }
}
