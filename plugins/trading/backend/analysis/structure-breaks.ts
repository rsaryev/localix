/**
 * STRUCTURE BREAKS (BOS / ChoCH) — the Smart-Money-Concepts read of market structure. Price prints
 * a sequence of swing highs and lows; a close beyond the most recent swing is a structural event:
 *   - BOS  (Break of Structure)   — a break IN the direction of the prevailing structure: the trend
 *                                    is continuing (higher high in an up-structure, lower low in a
 *                                    down-structure).
 *   - ChoCH (Change of Character) — the FIRST break AGAINST the prevailing structure: the up-trend's
 *                                    higher-low was taken out, or the down-trend's lower-high — an
 *                                    early reversal tell.
 * Pure, and reuses the SAME rolling-extrema swing points the levels and divergence read, so the
 * three never disagree on where a swing is. A counting method, not a signal.
 */
import type { Candle } from '../contracts'
import type { ChartCommandPayload } from '../chart-command'
import type { ChartDrawingSpec } from '../chart-drawing'
import { pivots, type Pivot } from './pattern-detect'
import { toolNumber } from '../tool-number'
import { BEARISH_COLOR, BULLISH_COLOR } from './draw-colors'

export interface StructureBreak {
  type: 'BOS' | 'ChoCH'
  direction: 'bullish' | 'bearish'
  /** The swing price a close pushed beyond. */
  level: number
  /** Unix seconds of the candle whose close confirmed the break. */
  brokenAt: number
  /** Unix seconds of the swing that was broken. */
  swingTime: number
}

/** The prevailing structure from the last two swings of each side: higher-high + higher-low is
 *  bullish, lower-high + lower-low bearish, anything mixed is neutral. */
function classifyStructure(highs: Pivot[], lows: Pivot[]): 'bullish' | 'bearish' | 'neutral' {
  if (highs.length < 2 || lows.length < 2) return 'neutral'
  const hh = highs.at(-1)!.price > highs.at(-2)!.price
  const hl = lows.at(-1)!.price > lows.at(-2)!.price
  const lh = highs.at(-1)!.price < highs.at(-2)!.price
  const ll = lows.at(-1)!.price < lows.at(-2)!.price
  if (hh && hl) return 'bullish'
  if (lh && ll) return 'bearish'
  return 'neutral'
}

/** Unix time of the first candle after `afterTime` whose close pushes past `level` in `dir`, or
 *  null if none did. */
function firstCloseBeyond(
  candles: Candle[],
  afterTime: number,
  level: number,
  dir: 'above' | 'below',
): number | null {
  for (const c of candles) {
    if (c.time <= afterTime) continue
    if (dir === 'above' ? c.close > level : c.close < level) return c.time
  }
  return null
}

/**
 * The most recent structure break near the end of the window, or null. `span` is the swing
 * half-width (matches the level scan's default); `recencyBars` bounds how far back a break may sit
 * and still count as the current character — a break older than that is history, not a live event.
 */
export function detectStructureBreak(
  candles: Candle[],
  span = 3,
  recencyBars = 12,
): StructureBreak | null {
  if (candles.length < span * 2 + 3) return null
  const { highs, lows } = pivots(candles, span)
  const structure = classifyStructure(highs, lows)
  const cutoff = candles[Math.max(0, candles.length - 1 - recencyBars)]!.time
  let event: StructureBreak | null = null
  const consider = (e: StructureBreak | null) => {
    if (e && e.brokenAt >= cutoff && (!event || e.brokenAt > event.brokenAt)) event = e
  }
  const refHigh = highs.at(-1)
  if (refHigh) {
    const brk = firstCloseBeyond(candles, refHigh.time, refHigh.price, 'above')
    if (brk !== null) {
      consider({
        type: structure === 'bullish' ? 'BOS' : 'ChoCH',
        direction: 'bullish',
        level: refHigh.price,
        brokenAt: brk,
        swingTime: refHigh.time,
      })
    }
  }
  const refLow = lows.at(-1)
  if (refLow) {
    const brk = firstCloseBeyond(candles, refLow.time, refLow.price, 'below')
    if (brk !== null) {
      consider({
        type: structure === 'bearish' ? 'BOS' : 'ChoCH',
        direction: 'bearish',
        level: refLow.price,
        brokenAt: brk,
        swingTime: refLow.time,
      })
    }
  }
  return event
}

/** A bullish break flips a former high to support (green); a bearish break flips a low to
 *  resistance (pink) — the detect-report palette. */

/**
 * The break as a single `draw` command: a dashed line at the broken swing level — now a flip
 * reference the market defends or rejects — labelled with the event (BOS/ChoCH). Stable `struct-brk`
 * id so a re-detect refreshes it. Empty when structure is intact.
 */
export function structureBreakDrawPayloads(
  connectionId: string,
  symbol: string,
  brk: StructureBreak | null,
): ChartCommandPayload[] {
  if (!brk) return []
  const drawing: ChartDrawingSpec = {
    kind: 'hline',
    id: 'struct-brk',
    price: brk.level,
    color: brk.direction === 'bullish' ? BULLISH_COLOR : BEARISH_COLOR,
    lineStyle: 'dashed',
    label: `${brk.type} ${brk.direction === 'bullish' ? '↑' : '↓'}`,
  }
  return [{ action: 'draw', connectionId, symbol, drawMode: 'add', drawing }]
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The break as one report line, or nothing when structure is intact. */
export function renderStructureBreak(brk: StructureBreak | null): string[] {
  if (!brk) return []
  const meaning =
    brk.type === 'BOS'
      ? `continuation of the ${brk.direction === 'bullish' ? 'up' : 'down'}-structure`
      : `character change — the ${brk.direction === 'bullish' ? 'down' : 'up'}-structure is at risk`
  return [
    `- structure: ${brk.direction} ${brk.type} — a close broke the swing ${brk.direction === 'bullish' ? 'high' : 'low'} ${toolNumber(brk.level)} (${meaning}).`,
  ]
}
