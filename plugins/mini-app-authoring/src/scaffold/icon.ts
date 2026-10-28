import { UserError } from '../lib/errors'

/**
 * A mini app's icon: one 24×24 stroke glyph — lucide's style, so it matches the screen's Icon —
 * drawn on the store tile every Localix app shares. The same tile everywhere is what makes the rail
 * and the Dock read as one family; the glyph is what tells the apps apart. A copy that kept the
 * template's icon looked like the template in both.
 */

const SHAPES = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'] as const
const SHAPE = new RegExp(
  `<(?:${SHAPES.join('|')})\\b[^<>]*?/?>(?:\\s*</(?:${SHAPES.join('|')})>)?`,
  'giu',
)
// What an attribute may not carry: script, a link out, an event handler.
const UNSAFE = /\bon[a-z]+\s*=|href|javascript:|url\(/iu

/** The glyph's shapes from a bare list of them, or from a whole `<svg>` wrapped around them. */
export function glyphShapes(markup: string): string {
  const inner = markup
    .trim()
    .replace(/^<\?xml[^>]*>\s*/iu, '')
    .replace(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/iu, '$1')
  const shapes = inner.match(SHAPE) ?? []
  const rest = inner.replace(SHAPE, '').trim()
  if (!shapes.length || rest || shapes.some((shape) => UNSAFE.test(shape))) {
    throw new UserError(
      `A glyph is only path, circle, rect, line, polyline, polygon and ellipse elements on a 24×24 grid, like a lucide icon's: ${(rest || markup).slice(0, 80)}`,
    )
  }
  return shapes.join('')
}

/** The icon file: the tile, and the glyph centred on it in `tint`. */
export function drawIcon(glyph: string, tint = '#e7e6e6'): string {
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(tint)) {
    throw new UserError(`--tint is a hex colour such as #4ade80, not "${tint}".`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="fall" x1="0" y1="64" x2="0" y2="960" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#121215"/>
      <stop offset="1" stop-color="#09090b"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#fall)"/>
  <svg x="312" y="312" width="400" height="400" viewBox="0 0 24 24" fill="none" stroke="${tint}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${glyphShapes(glyph)}</svg>
</svg>
`
}
