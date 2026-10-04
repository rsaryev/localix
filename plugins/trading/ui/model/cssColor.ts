/**
 * Normalize a CSS color into something lightweight-charts can parse.
 *
 * The library ships its own colour parser, and it understands hex, `rgb()`, `rgba()`, `hsl()`,
 * `hsla()` and the named colours — nothing else. Our theme tokens are `oklch()`, which is what CSS
 * Color 4 and every modern browser speak, so feeding a token straight through threw
 * `Error: Failed to parse color: oklch(0.74 0.16 155)` from deep inside the price-axis renderer and
 * took the whole chart down.
 *
 * Two traps, both paid for:
 *
 * 1. Setting `canvas.fillStyle` does NOT convert a modern colour function. The spec only serializes
 *    LEGACY colours (hex / rgb / hsl) back as `#rrggbb` / `rgba(…)`; `oklch()` round-trips VERBATIM.
 *    So the value must be PAINTED and the pixel read back to obtain real channels.
 *
 * 2. A resolver is a black box, and the first one silently returned the same unparsable string it
 *    was given. So the pure layer VALIDATES the output: whatever comes back must be a syntax the
 *    chart accepts, or it does not count as resolved. A test whose fake resolver echoes `oklch()`
 *    now fails, which is exactly what a fake that agrees with broken code must not be allowed to do.
 */

/** Resolve a CSS colour to concrete channels, or `null` when it is not a colour. */
export type ColorResolver = (value: string) => string | null

/** The syntaxes lightweight-charts' own parser accepts. Anything else throws inside the renderer. */
const HEX = /^#[0-9a-f]{3,8}$/i
const LEGACY_FN = /^(rgb|rgba|hsl|hsla)\([^()]*\)$/i
const NAMED = /^[a-z]+$/i

/**
 * Would lightweight-charts parse this? Hex, the four legacy colour functions, and the named
 * colours. `oklch(…)` — or any other modern colour function — is exactly what must NOT pass.
 */
export function isChartParsable(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return HEX.test(v) || LEGACY_FN.test(v) || NAMED.test(v)
}

/**
 * Pure: given a resolver, normalize `value`, falling back to `fallback` when `value` is blank, is
 * not a colour, or resolves to a syntax the chart cannot parse. The fallback runs the same gauntlet —
 * a fallback the chart cannot parse is no fallback. If nothing survives, `value` is returned verbatim
 * so the caller fails loudly rather than silently drawing in black.
 */
export function normalizeColor(value: string, fallback: string, resolve: ColorResolver): string {
  return usable(value, resolve) ?? usable(fallback, resolve) ?? value.trim() ?? fallback
}

function usable(value: string, resolve: ColorResolver): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // A value the chart already understands needs no round-trip through the browser.
  if (isChartParsable(trimmed)) return trimmed
  const resolved = resolve(trimmed)
  return resolved && isChartParsable(resolved) ? resolved : null
}

let ctx: CanvasRenderingContext2D | null | undefined

/**
 * The browser's own colour parser, via a 1×1 canvas: paint the colour and read the pixel back.
 * `null` outside a DOM, and `null` for anything the browser will not parse (an unparsable value
 * leaves `fillStyle` untouched, so two different sentinels disagree).
 *
 * Painting is what makes this work for `oklch()`: assigning `fillStyle` alone would hand the same
 * string straight back. Out-of-gamut colours clamp to sRGB, which is what CSS would have rendered.
 */
export function canvasColorResolver(value: string): string | null {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return null

  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  const fromBlack = ctx.fillStyle
  ctx.fillStyle = '#ffffff'
  ctx.fillStyle = value
  if (fromBlack !== ctx.fillStyle) return null // unparsable: both sentinels survived

  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  if (r === undefined || g === undefined || b === undefined || a === undefined) return null
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}
