/**
 * SESSION VWAP — the volume-weighted average price of the CURRENT UTC day, the intraday benchmark
 * institutions measure execution against. Price above VWAP is an intraday-bullish location (buyers
 * paying up), below is bearish; the ±1σ volume-weighted bands are the stretch a mean-reversion
 * trade fades. Anchored to the UTC day the same way the chart's VWAP indicator and the daily pivots
 * are, so the three agree. Pure; null-honest when the current day has no volume to weight by.
 */
import type { Candle } from '../contracts'
import { toolNumber } from '../tool-number'

export interface SessionVwap {
  vwap: number
  /** VWAP ± one volume-weighted standard deviation — the mean-reversion envelope. */
  upper: number
  lower: number
  /** Signed percent distance of the reference price from VWAP (positive = above). */
  distancePct: number
}

const DAY = 86_400

/**
 * The current UTC day's VWAP and ±1σ bands, plus where `price` (default: the last close) sits
 * relative to it. Null when the day carries no volume or too few bars to be meaningful.
 */
export function sessionVwap(candles: Candle[], minBars = 3): SessionVwap | null {
  const last = candles.at(-1)
  if (!last) return null
  const day = Math.floor(last.time / DAY)
  const bars = candles.filter((c) => Math.floor(c.time / DAY) === day)
  if (bars.length < minBars) return null
  let pv = 0
  let vol = 0
  for (const c of bars) {
    const v = c.volume ?? 0
    pv += ((c.high + c.low + c.close) / 3) * v
    vol += v
  }
  if (!(vol > 0)) return null
  const vwap = pv / vol
  // Volume-weighted variance of the typical price around VWAP → the σ bands.
  let wv = 0
  for (const c of bars) {
    const v = c.volume ?? 0
    const tp = (c.high + c.low + c.close) / 3
    wv += v * (tp - vwap) ** 2
  }
  const sd = Math.sqrt(wv / vol)
  const price = last.close
  return {
    vwap,
    upper: vwap + sd,
    lower: vwap - sd,
    distancePct: price > 0 ? ((price - vwap) / price) * 100 : 0,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The session VWAP as one report line, or nothing when it could not be computed. */
export function renderSessionVwap(v: SessionVwap | null): string[] {
  if (!v) return []
  const side =
    v.distancePct > 0.05
      ? 'above (intraday-bullish location)'
      : v.distancePct < -0.05
        ? 'below (intraday-bearish location)'
        : 'right at'
  return [
    `- session VWAP (UTC day): ${toolNumber(v.vwap)} — price ${v.distancePct >= 0 ? '+' : ''}${toolNumber(v.distancePct)}% ${side}; ±1σ band ${toolNumber(v.lower)}–${toolNumber(v.upper)} (the mean-reversion stretch).`,
  ]
}
