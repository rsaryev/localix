/**
 * ORDER BLOCKS — the remaining Smart-Money-Concepts / ICT zone (mined from the Vibe-Trading SMC
 * skill): the LAST opposite-direction candle before a displacement, read as the footprint of
 * institutional accumulation. A bullish order block is the last down-candle before a strong up
 * move (its range becomes demand — support on a retest), a bearish one the last up-candle before
 * a strong down move (supply). The classic claim is that price returning INTO an unmitigated
 * block tends to react there.
 *
 * Quantified honestly rather than by eyeball: "strong move" = the closes of the next few bars
 * travel at least DISPLACEMENT_ATR × ATR(14) away from the candidate candle's far edge. A block
 * is MITIGATED (dropped) once a later close passes fully through its far side — touching or
 * wicking into it keeps it valid (that IS the retest). Same zone/report/draw conventions as
 * `fair-value-gaps.ts`; pure — injected candles, no I/O.
 */
import type { Candle } from '../contracts'
import type { ChartCommandPayload } from '../chart-command'
import type { ChartDrawingSpec } from '../chart-drawing'
import { atr } from '../../ui/model/indicators'
import { toolNumber } from '../tool-number'
import { BEARISH_COLOR, BULLISH_COLOR } from './draw-colors'

export interface OrderBlock {
  direction: 'bullish' | 'bearish'
  /** The block band — the candle's full range (wicks included; the conservative zone). */
  top: number
  bottom: number
  mid: number
  /** Unix seconds of the block candle. */
  time: number
  /** Signed percent distance from the reference price to the nearest edge; 0 = price INSIDE. */
  distancePct: number
}

/** How many bars after the candidate may deliver the displacement. */
const DISPLACEMENT_WINDOW = 3
/** The displacement must travel at least this many ATR(14) beyond the candle's far edge. */
const DISPLACEMENT_ATR = 1.5

/**
 * Unmitigated order blocks near `price`, nearest first. For each opposite-direction candle, the
 * next `DISPLACEMENT_WINDOW` closes must reach `DISPLACEMENT_ATR × ATR` beyond its far edge
 * (above the high for bullish, below the low for bearish); a later CLOSE through the far side
 * mitigates the block and drops it.
 */
export function detectOrderBlocks(candles: Candle[], maxBlocks = 3): OrderBlock[] {
  const price = candles.at(-1)?.close
  if (price === undefined || !(price > 0)) return []
  const atrLine = atr(candles, 14)
  if (atrLine.length === 0) return []
  // ATR indexed by candle: atrLine[k] sits on candle index k + (candles.length - atrLine.length).
  const atrOffset = candles.length - atrLine.length
  const blocks: OrderBlock[] = []

  for (let i = Math.max(1, atrOffset); i + 1 < candles.length; i++) {
    const c = candles[i]!
    const bar = atrLine[i - atrOffset]?.value
    if (!bar || bar <= 0) continue
    const isDown = c.close < c.open
    const isUp = c.close > c.open
    if (!isDown && !isUp) continue
    const direction: OrderBlock['direction'] = isDown ? 'bullish' : 'bearish'

    // Displacement check over the next few closes, measured beyond the candle's far edge.
    let displaced = false
    for (let j = i + 1; j <= Math.min(i + DISPLACEMENT_WINDOW, candles.length - 1); j++) {
      const k = candles[j]!
      if (
        direction === 'bullish'
          ? k.close >= c.high + DISPLACEMENT_ATR * bar
          : k.close <= c.low - DISPLACEMENT_ATR * bar
      ) {
        displaced = true
        break
      }
    }
    if (!displaced) continue

    // The LAST opposite candle before the move: skip if the very next candle is same-direction
    // opposite (i.e. candidate must be adjacent to the impulse, not buried inside a pullback).
    const next = candles[i + 1]!
    if (direction === 'bullish' ? next.close < next.open : next.close > next.open) continue

    // Mitigated once a later CLOSE passes fully through the far side of the zone.
    let mitigated = false
    for (let j = i + 1; j < candles.length; j++) {
      const k = candles[j]!
      if (direction === 'bullish' ? k.close < c.low : k.close > c.high) {
        mitigated = true
        break
      }
    }
    if (mitigated) continue

    const top = c.high
    const bottom = c.low
    const distancePct =
      price >= bottom && price <= top
        ? 0
        : price < bottom
          ? ((bottom - price) / price) * 100
          : ((top - price) / price) * 100
    blocks.push({ direction, top, bottom, mid: (top + bottom) / 2, time: c.time, distancePct })
  }

  return blocks
    .sort((x, y) => Math.abs(x.distancePct) - Math.abs(y.distancePct))
    .slice(0, maxBlocks)
}

/** Same demand/supply palette as the FVG zones — one SMC visual language. */

/** The nearest unmitigated blocks as `zone` draw commands, stable `ob-*` ids (refresh, not stack). */
export function orderBlockDrawPayloads(
  connectionId: string,
  symbol: string,
  blocks: OrderBlock[],
  maxDrawn = 2,
): ChartCommandPayload[] {
  const drawings: ChartDrawingSpec[] = blocks.slice(0, maxDrawn).map((b, i) => ({
    kind: 'zone',
    id: `ob-${i + 1}`,
    price1: b.bottom,
    price2: b.top,
    color: b.direction === 'bullish' ? BULLISH_COLOR : BEARISH_COLOR,
    label: `OB ${b.direction === 'bullish' ? 'demand' : 'supply'}`,
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
/** The blocks as report lines — INSIDE flagged first (the retest is happening now). */
export function renderOrderBlocks(blocks: OrderBlock[]): string[] {
  if (blocks.length === 0) return []
  const lines: string[] = []
  const inside = blocks.find((b) => b.distancePct === 0)
  if (inside) {
    lines.push(
      `- INSIDE a ${inside.direction} order block NOW (${toolNumber(inside.bottom)}–${toolNumber(inside.top)}) — the retest is happening; expect a reaction.`,
    )
  }
  lines.push(
    '- order blocks (last opposite candle before a displacement — SMC/ICT; unmitigated, nearest first):',
  )
  for (const b of blocks) {
    const where =
      b.distancePct === 0 ? 'here' : `${b.distancePct >= 0 ? '+' : ''}${toolNumber(b.distancePct)}%`
    lines.push(
      `    · ${b.direction} ${b.direction === 'bullish' ? 'demand' : 'supply'} ${toolNumber(b.bottom)}–${toolNumber(b.top)} (${where})`,
    )
  }
  return lines
}
