import type { CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * How Claude Code's layout and text props read on a Localix screen. Spacing in terminal cells, or
 * a step name, becomes a step of the app's spacing; a size in cells becomes `ch` across and a
 * line down. A colour a terminal names is drawn with the theme's token for it, so a mod's red is
 * the app's error red in either theme; a hex or `rgb()` colour is drawn as given.
 */

/** One terminal cell of spacing, about a character of the app's text across. */
const CELL_PX = 8

const STEP_PX: Record<string, number> = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 }

export const space = (value: unknown): string | undefined =>
  typeof value === 'number'
    ? `${value * CELL_PX}px`
    : typeof value === 'string'
      ? `${STEP_PX[value] ?? 0}px`
      : undefined

const isPercent = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)

/** A size in cells across (`ch`) or down (a line), or a percentage as given. */
const cells = (value: unknown, unit: 'ch' | 'lh'): string | undefined =>
  typeof value === 'number'
    ? unit === 'ch'
      ? `${value}ch`
      : `${value * 1.5}em`
    : isPercent(value)
      ? value
      : undefined

/** Terminal colour names, as the theme's tokens draw them. */
const NAMED: Record<string, string> = {
  red: 'var(--status-error)',
  redBright: 'var(--status-error)',
  green: 'var(--status-success)',
  greenBright: 'var(--status-success)',
  yellow: 'var(--status-warning)',
  yellowBright: 'var(--status-warning)',
  blue: 'var(--status-info)',
  blueBright: 'var(--status-info)',
  cyan: 'var(--chart-2)',
  cyanBright: 'var(--chart-2)',
  magenta: 'var(--chart-5)',
  magentaBright: 'var(--chart-5)',
  gray: 'var(--text-faint)',
  grey: 'var(--text-faint)',
  white: 'var(--foreground)',
  whiteBright: 'var(--foreground)',
  black: 'var(--background)',
}

/** A colour a mod named: a terminal name as its token, a hex or `rgb()` as given, else none. */
export function colorOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value in NAMED) return NAMED[value]
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value) ? value : undefined
}

const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const

export function boxStyle(props: Record<string, unknown>): CSSProperties {
  const style: CSSProperties = {
    display: props.display === 'none' ? 'none' : 'flex',
    flexDirection: props.flexDirection === 'column' ? 'column' : 'row',
    flexWrap: props.flexWrap === 'wrap' ? 'wrap' : undefined,
    alignItems: typeof props.alignItems === 'string' ? props.alignItems : undefined,
    alignSelf: typeof props.alignSelf === 'string' ? props.alignSelf : undefined,
    justifyContent: typeof props.justifyContent === 'string' ? props.justifyContent : undefined,
    gap: space(props.gap),
    rowGap: space(props.rowGap),
    columnGap: space(props.columnGap),
    padding: space(props.padding),
    paddingInline: space(props.paddingX),
    paddingBlock: space(props.paddingY),
    margin: space(props.margin),
    marginInline: space(props.marginX),
    marginBlock: space(props.marginY),
    flexGrow: typeof props.flexGrow === 'number' ? props.flexGrow : undefined,
    flexShrink: typeof props.flexShrink === 'number' ? props.flexShrink : undefined,
    width: cells(props.width, 'ch'),
    minWidth: cells(props.minWidth, 'ch'),
    height: cells(props.height, 'lh'),
    minHeight: cells(props.minHeight, 'lh'),
    overflow: props.overflow === 'hidden' ? 'hidden' : undefined,
    backgroundColor: colorOf(props.backgroundColor),
    borderColor: colorOf(props.borderColor),
  }
  for (const side of SIDES) {
    const padding = space(props[`padding${side}`])
    const margin = space(props[`margin${side}`])
    if (padding !== undefined) style[`padding${side}`] = padding
    if (margin !== undefined) style[`margin${side}`] = margin
  }
  return style
}

const SIZE: Record<string, string> = {
  caption: 'text-2xs',
  footnote: 'text-xs',
  body: 'text-sm',
  heading: 'text-base',
  title: 'text-lg',
}

/** A `Text`'s classes and colours; `inverse` swaps its colour and its ground. */
export function textLook(props: Record<string, unknown>): {
  className: string
  style: CSSProperties
} {
  const color = colorOf(props.color)
  const ground = colorOf(props.backgroundColor)
  const inverse = props.inverse === true
  const truncated = typeof props.wrap === 'string' && props.wrap.startsWith('truncate')
  const weight =
    props.weight === 'semibold' || props.weight === 'bold' || (props.bold === true && !props.weight)
  const className = cn(
    weight && 'font-semibold',
    props.weight === 'medium' && 'font-medium',
    props.italic === true && 'italic',
    props.underline === true && 'underline',
    props.strikethrough === true && 'line-through',
    props.dimColor === true && !color && 'text-text-soft',
    props.dimColor === true && color && 'opacity-70',
    props.mono === true && 'font-mono',
    props.tabular === true && 'tabular-nums',
    typeof props.size === 'string' && SIZE[props.size],
    truncated && 'overflow-hidden text-ellipsis',
    inverse && 'rounded-sm px-0.5',
  )
  const style: CSSProperties = inverse
    ? {
        color: ground ?? 'var(--background)',
        backgroundColor: color ?? 'var(--foreground)',
      }
    : { color, backgroundColor: ground }
  // A terminal keeps every space a mod draws (`'  1% of context'` beside a word): so does this.
  style.whiteSpace = truncated ? 'pre' : 'pre-wrap'
  if (props.wrap === 'truncate-start') style.direction = 'rtl'
  return { className, style }
}
