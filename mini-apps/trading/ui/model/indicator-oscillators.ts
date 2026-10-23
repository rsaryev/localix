import type { LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { t } from './indicator-math'
/**
 * Oscillators derived from changes or positions within a window.
 * Their values use indicator-specific scales rather than raw price units.
 */

/**
 * Relative strength index (Wilder's smoothing). Needs `period + 1` bars for the first point (the
 * deltas, then the seed average). A window with no losses reads 100, no gains 0 — by construction.
 */
export function rsi(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = candles[i]!.close - candles[i - 1]!.close
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const point = (i: number): LineData => ({
    time: t(candles[i]!.time),
    value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss),
  })
  const out: LineData[] = [point(period)]
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i]!.close - candles[i - 1]!.close
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out.push(point(i))
  }
  return out
}

/**
 * Stochastic oscillator: raw %K = position of the close inside the `k`-bar high/low range,
 * smoothed by an SMA(`kSmooth`); %D = SMA(`d`) of the smoothed %K. A flat window (high == low)
 * reads 50 — the least-false claim available. First %K point lands on index
 * `k + kSmooth − 2`, %D another `d − 1` bars in.
 */
export function stoch(
  candles: Candle[],
  k: number,
  kSmooth: number,
  d: number,
): { k: LineData[]; d: LineData[] } {
  if (k < 1 || candles.length < k) return { k: [], d: [] }
  const raw: LineData[] = []
  for (let i = k - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - k + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j]!.high)
      lo = Math.min(lo, candles[j]!.low)
    }
    const range = hi - lo
    raw.push({
      time: t(candles[i]!.time),
      value: range === 0 ? 50 : ((candles[i]!.close - lo) / range) * 100,
    })
  }
  const sma = (line: LineData[], period: number): LineData[] => {
    if (line.length < period) return []
    const out: LineData[] = []
    let sum = 0
    for (let i = 0; i < line.length; i++) {
      sum += line[i]!.value
      if (i >= period) sum -= line[i - period]!.value
      if (i >= period - 1) out.push({ time: line[i]!.time, value: sum / period })
    }
    return out
  }
  const smoothed = sma(raw, kSmooth)
  return { k: smoothed, d: sma(smoothed, d) }
}

/**
 * Stochastic RSI (fast): the stochastic of the RSI series — where today's RSI sits within its own
 * `stochPeriod` range, %K smoothed by `kSmooth`, %D an SMA(`dSmooth`) of %K. Twice-derived, so it
 * turns harder and earlier than either parent; bounded 0–100 with the usual 20/80 bands.
 */
export function stochRsi(
  candles: Candle[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: LineData[]; d: LineData[] } {
  const rsiSeries = rsi(candles, rsiPeriod)
  if (rsiSeries.length < stochPeriod) return { k: [], d: [] }
  const raw: LineData[] = []
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      hi = Math.max(hi, rsiSeries[j]!.value)
      lo = Math.min(lo, rsiSeries[j]!.value)
    }
    const range = hi - lo
    raw.push({
      time: rsiSeries[i]!.time,
      value: range > 0 ? (100 * (rsiSeries[i]!.value - lo)) / range : 50,
    })
  }
  const smooth = (series: LineData[], n: number): LineData[] => {
    if (n <= 1) return series
    if (series.length < n) return []
    const out: LineData[] = []
    for (let i = n - 1; i < series.length; i++) {
      let sum = 0
      for (let j = i - n + 1; j <= i; j++) sum += series[j]!.value
      out.push({ time: series[i]!.time, value: sum / n })
    }
    return out
  }
  const k = smooth(raw, kSmooth)
  return { k, d: smooth(k, dSmooth) }
}

/** Commodity channel index: (TP − SMA(TP)) / (0.015 · mean deviation); a flat window reads 0. */
export function cci(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3)
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let mean = 0
    for (let j = i - period + 1; j <= i; j++) mean += tp[j]!
    mean /= period
    let dev = 0
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j]! - mean)
    dev /= period
    out.push({ time: t(candles[i]!.time), value: dev === 0 ? 0 : (tp[i]! - mean) / (0.015 * dev) })
  }
  return out
}

/** Chande momentum oscillator: 100·(ΣUp − ΣDown)/(ΣUp + ΣDown) over the window. */
export function cmo(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  const out: LineData[] = []
  for (let i = period; i < candles.length; i++) {
    let upSum = 0
    let downSum = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j]!.close - candles[j - 1]!.close
      if (d >= 0) upSum += d
      else downSum -= d
    }
    const total = upSum + downSum
    out.push({
      time: t(candles[i]!.time),
      value: total === 0 ? 0 : (100 * (upSum - downSum)) / total,
    })
  }
  return out
}

/**
 * Williams %R: where the close sits within the last `period` bars' high–low range, scaled to
 * −100..0. −100 is the very bottom of the range, 0 the very top; above −20 is overbought, below −80
 * oversold. The inverted twin of fast stochastic %K.
 */
export function williamsR(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j]!.high)
      lo = Math.min(lo, candles[j]!.low)
    }
    const range = hi - lo
    // (close − hi) keeps a close AT the high a clean +0 (−100·0 would be −0, which trips ===/toEqual).
    out.push({
      time: t(candles[i]!.time),
      value: range === 0 ? -50 : (100 * (candles[i]!.close - hi)) / range,
    })
  }
  return out
}

/**
 * Ultimate Oscillator (Williams): buying pressure over true range, blended across three windows
 * with 4/2/1 weights — `100·(4·avg(p1) + 2·avg(p2) + avg(p3)) / 7`. Bounded 0–100; the triple
 * blend damps the whipsaw a single-window oscillator prints. Classic read: <30 oversold, >70
 * overbought.
 */
export function ultimateOscillator(candles: Candle[], p1 = 7, p2 = 14, p3 = 28): LineData[] {
  if (candles.length < p3 + 1) return []
  // Per-bar buying pressure and true range (both need the prior close).
  const bp: number[] = []
  const tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!
    const prevClose = candles[i - 1]!.close
    const lo = Math.min(c.low, prevClose)
    const hi = Math.max(c.high, prevClose)
    bp.push(c.close - lo)
    tr.push(hi - lo)
  }
  const avg = (upto: number, n: number): number => {
    let b = 0
    let r = 0
    for (let j = upto - n + 1; j <= upto; j++) {
      b += bp[j]!
      r += tr[j]!
    }
    return r > 0 ? b / r : 0.5
  }
  const out: LineData[] = []
  for (let i = p3 - 1; i < bp.length; i++) {
    const value = (100 * (4 * avg(i, p1) + 2 * avg(i, p2) + avg(i, p3))) / 7
    out.push({ time: t(candles[i + 1]!.time), value })
  }
  return out
}

/** Choppiness index: 100·log10(ΣTR / range) / log10(n) — 100 = pure chop, 0 = pure trend. */
export function chop(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  const out: LineData[] = []
  for (let i = period; i < candles.length; i++) {
    let trSum = 0
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      const c = candles[j]!
      const prevClose = candles[j - 1]!.close
      trSum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
      hi = Math.max(hi, c.high)
      lo = Math.min(lo, c.low)
    }
    const range = hi - lo
    out.push({
      time: t(candles[i]!.time),
      value:
        range <= 0 || trSum <= 0 ? 100 : (100 * Math.log10(trSum / range)) / Math.log10(period),
    })
  }
  return out
}

/**
 * Fisher Transform (Ehlers): maps the median price's position in its `period` high-low range through
 * the inverse-hyperbolic-tangent, which pushes mid-range values toward the extremes — so turns that
 * a raw oscillator rounds off become sharp, near-vertical spikes, making reversals crisp. Two
 * recursive smoothers (Ehlers' canonical 0.66/0.67 and 0.5/0.5 coefficients); the input is clamped
 * to ±0.999 so the log never diverges. Emits once the `period` window exists.
 */
export function fisher(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const out: LineData[] = []
  let value1 = 0
  let fish = 0
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      const m = (candles[j]!.high + candles[j]!.low) / 2
      hi = Math.max(hi, m)
      lo = Math.min(lo, m)
    }
    const median = (candles[i]!.high + candles[i]!.low) / 2
    const range = hi - lo
    const pos = range > 0 ? (median - lo) / range - 0.5 : 0 // −0.5..0.5
    value1 = Math.max(-0.999, Math.min(0.999, 0.66 * pos + 0.67 * value1))
    fish = 0.5 * Math.log((1 + value1) / (1 - value1)) + 0.5 * fish
    out.push({ time: t(candles[i]!.time), value: fish })
  }
  return out
}

export { ao, bullBearPower, elderRay } from './indicator-price-momentum'
