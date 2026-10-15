/**
 * FAIR VALUE GAPS (FVG) — the Smart-Money-Concepts / ICT imbalance. When price moves so fast that
 * a three-candle window leaves a gap between the first candle's extreme and the third's (no trading
 * happened across that band), the market tends to return and "fill" it. An unfilled FVG is therefore
 * a magnet and a reference zone: bullish gaps below price act as support to revisit, bearish gaps
 * above as resistance. Pure counting — the same honest, method-transparent style as the other
 * analysis modules; an entry point for analysis, not a signal.
 *
 * A gap is a ZONE (top/bottom), not a line. We report only gaps still UNFILLED — price has not yet
 * traded fully back through them — nearest to the reference first.
 */
import type { Candle } from '../contracts'
import type { ChartCommandPayload } from '../chart-command'
import type { ChartDrawingSpec } from '../chart-drawing'
import { toolNumber } from '../tool-number'
import { BEARISH_COLOR, BULLISH_COLOR } from './draw-colors'

export interface FairValueGap {
  direction: 'bullish' | 'bearish'
  /** The gap band. */
  top: number
  bottom: number
  /** Band midpoint — the single price a magnet-style read points at. */
  mid: number
  /** Unix seconds of the middle (impulse) candle that opened the gap. */
  time: number
  /** Signed percent distance from the reference price to the nearest edge; 0 when price is INSIDE
   *  the gap (a live decision point). Positive = the gap sits above the price. */
  distancePct: number
}

/** A gap narrower than this fraction of price is microstructure noise, not an imbalance. */
const MIN_GAP_FRACTION = 0.0005

/**
 * Unfilled fair value gaps near `price`, nearest first. A three-candle window `[a,b,c]` opens a
 * gap when `a` and `c` do not overlap:
 *   - bullish: `a.high < c.low` → band `(a.high, c.low)`
 *   - bearish: `a.low  > c.high` → band `(c.high, a.low)`
 * The gap is UNFILLED while no later candle has traded fully across it (a bullish gap's floor
 * untouched from above, a bearish gap's ceiling untouched from below). `maxGaps` caps the output.
 */
export function detectFairValueGaps(candles: Candle[], maxGaps = 4): FairValueGap[] {
  const price = candles.at(-1)?.close
  if (price === undefined || !(price > 0) || candles.length < 3) return []
  const gaps: FairValueGap[] = []
  // Windows up to the second-to-last triple; the newest candle is `c` of the last window.
  for (let i = 0; i + 2 < candles.length; i++) {
    const a = candles[i]!
    const c = candles[i + 2]!
    let top: number
    let bottom: number
    let direction: FairValueGap['direction']
    if (a.high < c.low) {
      direction = 'bullish'
      bottom = a.high
      top = c.low
    } else if (a.low > c.high) {
      direction = 'bearish'
      bottom = c.high
      top = a.low
    } else {
      continue
    }
    if (top - bottom < price * MIN_GAP_FRACTION) continue
    // Filled once a later candle trades fully through the band from the far side.
    let filled = false
    for (let j = i + 3; j < candles.length; j++) {
      const k = candles[j]!
      if (direction === 'bullish' ? k.low <= bottom : k.high >= top) {
        filled = true
        break
      }
    }
    if (filled) continue
    const mid = (top + bottom) / 2
    const distancePct =
      price >= bottom && price <= top
        ? 0
        : price < bottom
          ? ((bottom - price) / price) * 100
          : ((top - price) / price) * 100
    gaps.push({ direction, top, bottom, mid, time: candles[i + 1]!.time, distancePct })
  }
  return gaps.sort((x, y) => Math.abs(x.distancePct) - Math.abs(y.distancePct)).slice(0, maxGaps)
}

/** Bullish gaps read as demand (green), bearish as supply (pink) — the detect-report palette. */

/**
 * The nearest unfilled gaps as `zone` draw commands — shaded price bands, stable `fvg-*` ids so a
 * re-detect refreshes rather than stacks. Capped so the imbalance overlay never crowds the level
 * lines already drawn (the shared per-tab drawing cap is finite).
 */
export function fvgDrawPayloads(
  connectionId: string,
  symbol: string,
  gaps: FairValueGap[],
  maxDrawn = 3,
): ChartCommandPayload[] {
  const drawings: ChartDrawingSpec[] = gaps.slice(0, maxDrawn).map((g, i) => ({
    kind: 'zone',
    id: `fvg-${i + 1}`,
    price1: g.bottom,
    price2: g.top,
    color: g.direction === 'bullish' ? BULLISH_COLOR : BEARISH_COLOR,
    label: `FVG ${g.direction === 'bullish' ? 'demand' : 'supply'}`,
  }))
  return drawings.map((drawing) => ({
    action: 'draw',
    connectionId,
    symbol,
    drawMode: 'add',
    drawing,
  }))
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/**
 * The unfilled gaps as report lines — the imbalance zones price is drawn back to, or nothing. A gap
 * price is sitting INSIDE is flagged first: it is the live decision point (the fill is happening
 * now). Otherwise each gap reads as a band with its side and signed distance.
 */
export function renderFairValueGaps(gaps: FairValueGap[]): string[] {
  if (gaps.length === 0) return []
  const lines: string[] = []
  const inside = gaps.find((g) => g.distancePct === 0)
  if (inside) {
    lines.push(
      `- INSIDE a ${inside.direction} fair value gap NOW (${toolNumber(inside.bottom)}–${toolNumber(inside.top)}) — the imbalance is filling here; expect a reaction.`,
    )
  }
  lines.push(
    '- fair value gaps (unfilled imbalances price tends to revisit — SMC/ICT; nearest first):',
  )
  for (const g of gaps) {
    const where =
      g.distancePct === 0 ? 'here' : `${g.distancePct >= 0 ? '+' : ''}${toolNumber(g.distancePct)}%`
    lines.push(`    · ${g.direction} ${toolNumber(g.bottom)}–${toolNumber(g.top)} (${where})`)
  }
  return lines
}
