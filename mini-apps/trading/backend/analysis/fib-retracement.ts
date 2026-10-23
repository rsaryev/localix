/**
 * Fibonacci retracement over the scanned window's dominant swing — the pullback zones a trend is
 * most watched to retrace to (38.2 / 50 / 61.8 the heavily-traded trio). Oriented by trend: in an
 * up-leg the levels are measured DOWN from the swing high (pullback SUPPORT); in a down-leg UP from
 * the swing low (bounce RESISTANCE). Pure over the candles + the trend direction the scan already
 * has; the swing is the window's own high-to-low range, so a reader can point at both anchors.
 */
import type { Candle } from '../contracts'
import type { ChartCommandPayload } from '../chart-command'
import type { ChartDrawingSpec } from '../chart-drawing'
import { toolNumber } from '../tool-number'

/** The retracement ratios reported — the standard set, the middle three doing the real work. */
export const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const

/** Distinct-on-both-themes accent for the drawn fib lines (quiet, dashed). */
const FIB_COLOR = '#facc15'

export interface FibRetracement {
  swingHigh: number
  swingLow: number
  /** Which side the levels retrace from — an up-leg pulls back to support, a down-leg to resistance. */
  direction: 'up' | 'down'
  /** Each ratio with its price, ordered as {@link FIB_RATIOS}. */
  levels: Array<{ ratio: number; price: number }>
}

/**
 * The retracement, or null when the window has no range (a dead-flat series). `trend` orients the
 * levels; a flat trend defaults to the up-leg reading (pullback support), the more common frame.
 */
export function fibRetracement(
  candles: Candle[],
  trend: 'up' | 'down' | 'flat' | null,
): FibRetracement | null {
  if (candles.length < 2) return null
  let swingHigh = -Infinity
  let swingLow = Infinity
  for (const c of candles) {
    if (c.high > swingHigh) swingHigh = c.high
    if (c.low < swingLow) swingLow = c.low
  }
  const range = swingHigh - swingLow
  if (!(range > 0)) return null
  const direction: 'up' | 'down' = trend === 'down' ? 'down' : 'up'
  const levels = FIB_RATIOS.map((ratio) => ({
    ratio,
    // Up-leg: retrace down from the high. Down-leg: retrace up from the low.
    price: direction === 'up' ? swingHigh - ratio * range : swingLow + ratio * range,
  }))
  return { swingHigh, swingLow, direction, levels }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The retracement as a report line naming the swing, the key levels, and what they are. */
export function renderFibRetracement(fib: FibRetracement): string[] {
  const keyLevels: string[] = []
  for (const level of fib.levels) {
    if (level.ratio === 0.382 || level.ratio === 0.5 || level.ratio === 0.618) {
      keyLevels.push(`${(level.ratio * 100).toFixed(1)}% ${toolNumber(level.price)}`)
    }
  }
  const key = keyLevels.join(', ')
  const role =
    fib.direction === 'up' ? 'pullback support in the up-leg' : 'bounce resistance in the down-leg'
  return [
    `- fib retracement (swing ${toolNumber(fib.swingLow)}→${toolNumber(fib.swingHigh)}): ${key} — ${role}`,
  ]
}

/**
 * The fib retracement drawn where it is most actionable: the GOLDEN POCKET (0.618–0.786) as a
 * shaded zone — the high-probability reversal band a trend is most watched to turn from — plus the
 * 0.5 pivot as a single dashed line. Stable `fib-*` ids (a re-detect replaces its own overlays).
 * A band beats three separate lines: it reads as a region, not clutter, and the 23.6/38.2/78.6
 * levels stay in the text. When the pocket edges are missing (a partial swing) only the 0.5 line
 * is drawn.
 */
export function fibDrawPayloads(
  connectionId: string,
  symbol: string,
  fib: FibRetracement,
): ChartCommandPayload[] {
  const at = (ratio: number) => fib.levels.find((l) => l.ratio === ratio)?.price
  const drawings: ChartDrawingSpec[] = []
  const p618 = at(0.618)
  const p786 = at(0.786)
  if (p618 !== undefined && p786 !== undefined) {
    drawings.push({
      kind: 'zone',
      id: 'fib-golden',
      price1: p618,
      price2: p786,
      color: FIB_COLOR,
      label: 'Golden pocket',
    })
  }
  const p50 = at(0.5)
  if (p50 !== undefined) {
    drawings.push({
      kind: 'hline',
      id: 'fib-500',
      price: p50,
      color: FIB_COLOR,
      lineStyle: 'dashed',
      label: 'Fib 50.0',
    })
  }
  return drawings.map((drawing) => ({
    action: 'draw',
    connectionId,
    symbol,
    drawMode: 'add',
    drawing,
  }))
}
