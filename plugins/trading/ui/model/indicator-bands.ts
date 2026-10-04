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

/**
 * Session VWAP, anchored to the UTC day: cumulative Σ(typical·volume)/Σ(volume), reset on every
 * day boundary. No lookback window — the anchor IS the honesty rule, so it emits from the first
 * bar of each day. A bar the venue reported no volume for carries the running value forward
 * (weight 0); a day whose bars ALL lack volume emits nothing (there is no volume to weight by).
 */
export function vwap(candles: Candle[]): LineData[] {
  const out: LineData[] = []
  let day = Number.NaN
  let pv = 0
  let vol = 0
  for (const c of candles) {
    const d = Math.floor(c.time / 86_400)
    if (d !== day) {
      day = d
      pv = 0
      vol = 0
    }
    const v = c.volume ?? 0
    pv += ((c.high + c.low + c.close) / 3) * v
    vol += v
    if (vol > 0) out.push({ time: t(c.time), value: pv / vol })
  }
  return out
}

/**
 * Session VWAP σ-bands: the daily VWAP basis (same anchor + honesty rule as {@link vwap}) with
 * `mult`-sigma envelopes, where σ is the volume-weighted standard deviation of the typical price
 * about the running VWAP within the session. The band is the institutional intraday value area —
 * price at ±2σ is stretched from session value, the classic mean-reversion reference. Resets on
 * every UTC-day boundary; emits only where the session has volume.
 */
export function vwapBands(
  candles: Candle[],
  mult: number,
): { basis: LineData[]; upper: LineData[]; lower: LineData[] } {
  const basis: LineData[] = []
  const upper: LineData[] = []
  const lower: LineData[] = []
  let day = Number.NaN
  let pv = 0
  let pv2 = 0
  let vol = 0
  for (const c of candles) {
    const d = Math.floor(c.time / 86_400)
    if (d !== day) {
      day = d
      pv = 0
      pv2 = 0
      vol = 0
    }
    const v = c.volume ?? 0
    const tp = (c.high + c.low + c.close) / 3
    pv += tp * v
    pv2 += tp * tp * v
    vol += v
    if (vol > 0) {
      const mean = pv / vol
      // Volume-weighted variance = E[tp²] − E[tp]²; clamp tiny negatives from rounding.
      const variance = Math.max(0, pv2 / vol - mean * mean)
      const width = mult * Math.sqrt(variance)
      const time = t(c.time)
      basis.push({ time, value: mean })
      upper.push({ time, value: mean + width })
      lower.push({ time, value: mean - width })
    }
  }
  return { basis, upper, lower }
}

/**
 * Classic floor-trader pivot points as PER-BAR step series: every bar carries its UTC day's pivot
 * levels, derived from the PRIOR day's high/low/close (PP = (H+L+C)/3, R1/S1/R2/S2 stepped off it).
 * Constant within a day, jumping at each boundary — drawn as stepped lines. The first day emits
 * nothing (no prior day to derive from), the same honesty rule the other session indicators keep.
 */
export function pivotSeries(candles: Candle[]): {
  pp: LineData[]
  r1: LineData[]
  r2: LineData[]
  s1: LineData[]
  s2: LineData[]
} {
  const days: Array<{ day: number; high: number; low: number; close: number }> = []
  for (const c of candles) {
    const day = Math.floor(c.time / 86_400)
    const last = days.at(-1)
    if (last?.day === day) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
    } else {
      days.push({ day, high: c.high, low: c.low, close: c.close })
    }
  }
  // Each day's pivots come from the PRIOR day's HLC.
  const byDay = new Map<number, { pp: number; r1: number; r2: number; s1: number; s2: number }>()
  for (let i = 1; i < days.length; i++) {
    const p = days[i - 1]!
    const pp = (p.high + p.low + p.close) / 3
    const range = p.high - p.low
    byDay.set(days[i]!.day, {
      pp,
      r1: 2 * pp - p.low,
      s1: 2 * pp - p.high,
      r2: pp + range,
      s2: pp - range,
    })
  }
  const out = {
    pp: [] as LineData[],
    r1: [] as LineData[],
    r2: [] as LineData[],
    s1: [] as LineData[],
    s2: [] as LineData[],
  }
  for (const c of candles) {
    const piv = byDay.get(Math.floor(c.time / 86_400))
    if (!piv) continue
    const time = t(c.time)
    out.pp.push({ time, value: piv.pp })
    out.r1.push({ time, value: piv.r1 })
    out.r2.push({ time, value: piv.r2 })
    out.s1.push({ time, value: piv.s1 })
    out.s2.push({ time, value: piv.s2 })
  }
  return out
}

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
