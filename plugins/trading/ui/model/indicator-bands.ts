import type { LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { movingAverage } from './candleSeries'
import { ema } from './indicator-averages'
import { t } from './indicator-math'
/**
 * Bands, channels and the volatility measures that size them.
 *
 * `atr` and `historicalVol` live here rather than with the oscillators because they are what the
 * channels are drawn FROM — a Keltner band is an ATR multiple, and separating the two would put
 * the width and the thing it widens in different files.
 */

/** Bollinger bands: SMA basis ± `mult` population standard deviations over the same window. */
export function bollinger(
  candles: Candle[],
  period: number,
  mult: number,
): { basis: LineData[]; upper: LineData[]; lower: LineData[] } {
  const basis = movingAverage(candles, period)
  const upper: LineData[] = []
  const lower: LineData[] = []
  for (let b = 0; b < basis.length; b++) {
    const end = b + period - 1 // the candle index this basis point sits on
    const mean = basis[b]!.value
    let variance = 0
    for (let i = end - period + 1; i <= end; i++) {
      const d = candles[i]!.close - mean
      variance += d * d
    }
    const width = mult * Math.sqrt(variance / period)
    upper.push({ time: basis[b]!.time, value: mean + width })
    lower.push({ time: basis[b]!.time, value: mean - width })
  }
  return { basis, upper, lower }
}

/** Bollinger band width: (upper − lower)/basis · 100 — the squeeze detector. */
export function bbWidth(candles: Candle[], period: number, mult: number): LineData[] {
  const { basis, upper, lower } = bollinger(candles, period, mult)
  return basis.map((b, i) => ({
    time: b.time,
    value: b.value === 0 ? 0 : ((upper[i]!.value - lower[i]!.value) / b.value) * 100,
  }))
}

/** Bollinger %B: the close's position inside the bands (0 = lower, 100 = upper). */
export function bbPercent(candles: Candle[], period: number, mult: number): LineData[] {
  const { basis, upper, lower } = bollinger(candles, period, mult)
  const start = candles.length - basis.length
  return basis.map((b, i) => {
    const range = upper[i]!.value - lower[i]!.value
    const close = candles[start + i]!.close
    return {
      time: b.time,
      value: range === 0 ? 50 : ((close - lower[i]!.value) / range) * 100,
    }
  })
}

/** Donchian channels: window high / low and their midpoint. */
export function donchian(
  candles: Candle[],
  period: number,
): { upper: LineData[]; basis: LineData[]; lower: LineData[] } {
  if (period < 1 || candles.length < period) return { upper: [], basis: [], lower: [] }
  const upper: LineData[] = []
  const basis: LineData[] = []
  const lower: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j]!.high)
      lo = Math.min(lo, candles[j]!.low)
    }
    const time = t(candles[i]!.time)
    upper.push({ time, value: hi })
    lower.push({ time, value: lo })
    basis.push({ time, value: (hi + lo) / 2 })
  }
  return { upper, basis, lower }
}

/** Keltner channels: EMA(period) basis ± mult·ATR(period). Starts where BOTH lines exist. */
export function keltner(
  candles: Candle[],
  period: number,
  mult: number,
): { upper: LineData[]; basis: LineData[]; lower: LineData[] } {
  const basisFull = ema(candles, period)
  const atrLine = atr(candles, period)
  if (basisFull.length === 0 || atrLine.length === 0) return { upper: [], basis: [], lower: [] }
  // EMA emits from index period−1, ATR from index period — trim the basis to ATR's head.
  const offset = basisFull.length - atrLine.length
  const upper: LineData[] = []
  const lower: LineData[] = []
  const basis: LineData[] = []
  for (let i = 0; i < atrLine.length; i++) {
    const b = basisFull[i + offset]!
    const width = atrLine[i]!.value * mult
    basis.push(b)
    upper.push({ time: b.time, value: b.value + width })
    lower.push({ time: b.time, value: b.value - width })
  }
  return { upper, basis, lower }
}

/**
 * Envelopes: an SMA(period) basis with bands a fixed PERCENT above and below it. Unlike Bollinger
 * (which breathes with volatility), the band width is constant, so price tagging the envelope is a
 * pure distance-from-the-mean read — a classic overbought/oversold and mean-reversion tool.
 */
export function envelopes(
  candles: Candle[],
  period: number,
  pct: number,
): { basis: LineData[]; upper: LineData[]; lower: LineData[] } {
  const basis = movingAverage(candles, period)
  const f = pct / 100
  return {
    basis,
    upper: basis.map((b) => ({ time: b.time, value: b.value * (1 + f) })),
    lower: basis.map((b) => ({ time: b.time, value: b.value * (1 - f) })),
  }
}

export { vwap, vwapBands, pivotSeries } from './indicator-sessions'

/**
 * Average true range (Wilder's smoothing). The first TR needs the previous close, so the seed
 * average covers bars `1..period` and the first point lands on index `period` — the honesty rule
 * with the same shape as `rsi`.
 */
export function atr(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  const tr = (i: number): number => {
    const c = candles[i]!
    const prevClose = candles[i - 1]!.close
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
  }
  let value = 0
  for (let i = 1; i <= period; i++) value += tr(i)
  value /= period
  const out: LineData[] = [{ time: t(candles[period]!.time), value }]
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + tr(i)) / period
    out.push({ time: t(candles[i]!.time), value })
  }
  return out
}

/**
 * Historical Volatility: the standard deviation of the last `period` LOG returns, in percent — a
 * return-based volatility distinct from ATR's range-based one (it feels the closes' dispersion, not
 * the bars' reach). Reported PER BAR, deliberately NOT annualized: annualizing needs the bars-per-
 * year, which depends on a timeframe this pure math cannot see — so the honest figure is the raw
 * per-bar realized vol, whose RISE/FALL and level relative to itself carry the signal.
 */
export function historicalVol(candles: Candle[], period: number): LineData[] {
  if (period < 2 || candles.length < period + 1) return []
  const rets: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close
    rets.push(prev > 0 && candles[i]!.close > 0 ? Math.log(candles[i]!.close / prev) : 0)
  }
  const out: LineData[] = []
  for (let i = period - 1; i < rets.length; i++) {
    let mean = 0
    for (let j = i - period + 1; j <= i; j++) mean += rets[j]!
    mean /= period
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = rets[j]! - mean
      variance += d * d
    }
    // rets[i] is the return INTO candle i+1, so the window lands on that bar.
    out.push({ time: t(candles[i + 1]!.time), value: Math.sqrt(variance / period) * 100 })
  }
  return out
}
