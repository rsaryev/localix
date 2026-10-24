import type { ModSite } from './modSite'

/**
 * Colour, as a mod names it for a terminal, read as the app's own palette. A terminal mod reaches
 * for `magenta` and `cyan` because a terminal has eight colours; drawn literally on a Localix
 * screen they are the loudest thing on it, in a hue nothing else in the app uses. So no colour
 * reaches the screen as named: each lands on one of a few semantic TONES, and a tone is painted
 * with the tokens the app's own surfaces use for that meaning, in both themes.
 *
 * | Named (and its `Bright` twin), or the hex nearest it | Tone      | Token                  |
 * | ---------------------------------------------------- | --------- | ---------------------- |
 * | red                                                  | `danger`  | `--status-error`       |
 * | green                                                | `success` | `--status-success`     |
 * | yellow (orange hues too)                             | `warning` | `--status-warning`     |
 * | blue, cyan                                           | `info`    | `--status-info`        |
 * | magenta (purple hues too)                            | `accent`  | `--conn-violet`, toned |
 * | gray, grey, `blackBright`, a dark grey               | `muted`   | `--text-faint`         |
 * | white, black, a light grey                           | `plain`   | the text's own colour  |
 *
 * Colour is for TEXT. A fill or frame never carries a hue at strength: `inverse` is the selected
 * segment veil, a box's ground a neutral veil, a text's ground the kit chip's 12% tint, and a
 * border the border token (a status tone tints it faintly, nothing else does).
 */

export type ModTone = 'danger' | 'success' | 'warning' | 'info' | 'accent' | 'muted' | 'plain'

type HueTone = Exclude<ModTone, 'muted' | 'plain'>

const TOKEN: Record<HueTone, string> = {
  danger: 'var(--status-error)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  info: 'var(--status-info)',
  accent: 'var(--conn-violet)',
}

const NAMED: Record<string, ModTone> = {
  red: 'danger',
  green: 'success',
  yellow: 'warning',
  blue: 'info',
  cyan: 'info',
  magenta: 'accent',
  gray: 'muted',
  grey: 'muted',
  white: 'plain',
  black: 'plain',
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

/** An exact colour as the tone nearest its hue; a grey as muted or plain by its lightness. */
function nearestTone([r, g, b]: [number, number, number]): ModTone {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const chroma = max - min
  if (chroma < 0.15) return (max + min) / 2 > 0.7 ? 'plain' : 'muted'
  const hue =
    max === rn
      ? (60 * ((gn - bn) / chroma) + 360) % 360
      : max === gn
        ? 60 * ((bn - rn) / chroma) + 120
        : 60 * ((rn - gn) / chroma) + 240
  if (hue < 20 || hue >= 330) return 'danger'
  if (hue < 70) return 'warning'
  if (hue < 165) return 'success'
  if (hue < 255) return 'info'
  return 'accent'
}

/** The tone of a colour a mod named: a terminal name (its `Bright` twin too), a hex or rgb. */
export function toneOf(value: unknown): ModTone | undefined {
  if (typeof value !== 'string') return undefined
  if (value === 'blackBright') return 'muted'
  const name = value.replace(/Bright$/, '')
  if (name in NAMED) return NAMED[name]
  const rgb = rgbOf(value)
  return rgb ? nearestTone(rgb) : undefined
}

const mix = (token: string, percent: number, base: string) =>
  `color-mix(in oklab, ${token} ${percent}%, ${base})`

/**
 * A text's colour at the site, or none (the site's own text colour). A pane paints a status tone
 * as the app's status text does (`text-status-*`: the diff's +/− counts, a failed job); the band
 * is chrome, so there every tone is toned into the strip's soft text. The accent is toned in both:
 * a full violet is the hue the app never uses for text. `dim` fades a colour toward the faint text.
 */
export function textColorOf(value: unknown, site: ModSite, dim: boolean): string | undefined {
  const tone = toneOf(value)
  if (!tone || tone === 'plain') return undefined
  if (tone === 'muted') return 'var(--text-faint)'
  const token = TOKEN[tone]
  if (dim) return mix(token, 60, 'var(--text-faint)')
  if (tone === 'accent') return mix(token, 45, 'var(--text-soft)')
  return site === 'band' ? mix(token, 75, 'var(--text-soft)') : token
}

/** `inverse`: the selected segment (a step strip's current cell), never a block of the colour. */
export const INVERSE = {
  backgroundColor: 'var(--surface-active)',
  color: 'var(--foreground)',
} as const

/**
 * `backgroundColor`: on a text, the kit chip's tint of its tone (`bg-status-*\/12`); on a box,
 * a surface too large for any hue, so the neutral field veil.
 */
export function fillOf(value: unknown, on: 'text' | 'box'): string | undefined {
  const tone = toneOf(value)
  if (!tone) return undefined
  if (on === 'box' || tone === 'muted' || tone === 'plain') return 'var(--field-fill)'
  return mix(TOKEN[tone], 12, 'transparent')
}

/** `borderColor`: the frame's own border token; a status tone tints it faintly, nothing else. */
export function borderColorOf(value: unknown): string | undefined {
  const tone = toneOf(value)
  if (tone !== 'danger' && tone !== 'warning' && tone !== 'success') return undefined
  return mix(TOKEN[tone], 25, 'var(--color-border-faint)')
}
