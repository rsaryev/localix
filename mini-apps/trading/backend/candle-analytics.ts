/**
 * Pure candle analytics shared by the agent's `market_data` tool. Numeric only — no chart handle, no
 * formatting — so it is unit-tested in isolation and stays honest about missing data.
 *
 * The chart overlays MA20 + MA50 (`ui/model/candleSeries.ts` `movingAverage`, which returns a
 * lightweight-charts `LineData[]` the agent can't consume). This is the same figure for the agent: a
 * TRAILING simple moving average — the single most recent value, not a whole line. One rule, two
 * surfaces: the number the human reads off the chart is the number the agent reasons from.
 */

/**
 * The trailing simple moving average of the last `period` closes, or `null` when the window is too
 * short to compute it honestly. A partial average over fewer bars is a different, misleading number
 * (a "50 MA" that is really a 30-bar mean), so an unmet period yields `null`, never a warped value.
 */
export function sma(closes: number[], period: number): number | null {
  if (period < 1 || closes.length < period) return null
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]!
  return sum / period
}

/** A trailing SMA paired with the period it was computed over. `value` is `null` when unavailable. */
export interface MaValue {
  period: number
  value: number | null
}

/** Trailing SMAs for several periods in one pass over the closes. */
export function movingAverages(closes: number[], periods: number[]): MaValue[] {
  return periods.map((period) => ({ period, value: sma(closes, period) }))
}

/**
 * The bias a fast/slow moving-average pair implies — the classic crossover read. `null` when either
 * average is unavailable (the window is too short for the slow one): a bias derived from a missing
 * average is not a bias at all, and "we don't know yet" must never render as "flat/neutral".
 */
export function maCrossBias(
  fast: number | null,
  slow: number | null,
): 'bullish' | 'bearish' | 'flat' | null {
  if (fast === null || slow === null) return null
  return fast > slow ? 'bullish' : fast < slow ? 'bearish' : 'flat'
}
