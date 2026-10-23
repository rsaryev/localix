/**
 * Classic floor-trader PIVOT POINTS for the current session — the intraday level set day traders
 * lean on, computed from the PRIOR UTC day's high/low/close: PP = (H+L+C)/3, then R1/S1/R2/S2
 * stepped off it. Pure over the candles; null when fewer than two UTC days are loaded (no prior
 * day to derive today's pivots from). Timeframe-agnostic — the day grouping folds any bar size.
 */
import type { Candle } from '../contracts'
import { toolNumber } from '../tool-number'

export interface PivotPoints {
  pp: number
  r1: number
  r2: number
  s1: number
  s2: number
}

/** Aggregate one UTC day's candles into its high / low / (closing) close. */
interface DayHlc {
  day: number
  high: number
  low: number
  close: number
}

/** The prior completed UTC day's HLC — the basis for today's pivots — or null when there isn't one. */
function priorDay(candles: Candle[]): DayHlc | null {
  const days: DayHlc[] = []
  for (const c of candles) {
    const day = Math.floor(c.time / 86_400)
    const last = days.at(-1)
    if (last?.day === day) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close // the day's LAST close so far
    } else {
      days.push({ day, high: c.high, low: c.low, close: c.close })
    }
  }
  // The last distinct day is "today" (possibly incomplete); its pivots come from the one before.
  return days.length >= 2 ? days[days.length - 2]! : null
}

/** Classic pivots for the current day, or null when there is no prior day to derive them from. */
export function pivotPoints(candles: Candle[]): PivotPoints | null {
  const prior = priorDay(candles)
  if (!prior) return null
  const { high, low, close } = prior
  const pp = (high + low + close) / 3
  const range = high - low
  return {
    pp,
    r1: 2 * pp - low,
    s1: 2 * pp - high,
    r2: pp + range,
    s2: pp - range,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The pivots as one report line — resistances above, PP, supports below. */
export function renderPivotPoints(p: PivotPoints): string[] {
  return [
    `- daily pivots (from the prior day): R2 ${toolNumber(p.r2)}, R1 ${toolNumber(p.r1)}, PP ${toolNumber(p.pp)}, S1 ${toolNumber(p.s1)}, S2 ${toolNumber(p.s2)}`,
  ]
}
