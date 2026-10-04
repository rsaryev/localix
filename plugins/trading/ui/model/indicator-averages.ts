import type { LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { emaValues, t, wmaValues } from './indicator-math'
/**
 * Moving averages, and the plain rate-of-change lines built directly on top of them.
 *
 * The family is defined by shape rather than by use: each of these is one smoothed line over
 * price, and the arguments are always "which candles, over what period".
 */

/** Exponential moving average of the closes, seeded with the SMA of the first `period` closes. */
export function ema(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const k = 2 / (period + 1)
  let value = 0
  for (let i = 0; i < period; i++) value += candles[i]!.close
  value /= period
  const out: LineData[] = [{ time: t(candles[period - 1]!.time), value }]
  for (let i = period; i < candles.length; i++) {
    value = candles[i]!.close * k + value * (1 - k)
    out.push({ time: t(candles[i]!.time), value })
  }
  return out
}

/** Hull moving average: WMA(2·WMA(n/2) − WMA(n), √n) — the classic lag-cancelling composition. */
export function hma(candles: Candle[], period: number): LineData[] {
  const closes = candles.map((c) => c.close)
  const half = Math.max(1, Math.round(period / 2))
  const sqrtP = Math.max(1, Math.round(Math.sqrt(period)))
  const wHalf = wmaValues(closes, half)
  const wFull = wmaValues(closes, period)
  if (wFull.length === 0) return []
  const offset = wHalf.length - wFull.length
  const diff = wFull.map((v, i) => 2 * wHalf[i + offset]! - v)
  const smoothed = wmaValues(diff, sqrtP)
  const start = candles.length - smoothed.length
  return smoothed.map((value, i) => ({ time: t(candles[start + i]!.time), value }))
}

/** Double EMA: 2·EMA(n) − EMA(EMA(n)) — lag compensation by extrapolating the smoothing. */
export function dema(candles: Candle[], period: number): LineData[] {
  const e1 = ema(candles, period)
  const e2 = emaValues(
    e1.map((p) => p.value),
    period,
  )
  // e2[j] (the EMA-of-EMA) aligns with e1[period − 1 + j]; DEMA = 2·EMA − EMA(EMA) there.
  const offset = e1.length - e2.length
  return e2.map((emaOfEma, j) => ({
    time: e1[j + offset]!.time,
    value: 2 * e1[j + offset]!.value - emaOfEma,
  }))
}

/** Arnaud Legoux MA with the standard offset 0.85 / sigma 6 gaussian weights. */
export function alma(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const m = 0.85 * (period - 1)
  const s = period / 6
  const weights: number[] = []
  let norm = 0
  for (let j = 0; j < period; j++) {
    const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s))
    weights.push(w)
    norm += w
  }
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += candles[i - period + 1 + j]!.close * weights[j]!
    out.push({ time: t(candles[i]!.time), value: sum / norm })
  }
  return out
}

/** Least-squares MA (linear regression curve): the regression line's endpoint per window. */
export function lsma(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  // Closed forms over x = 0..period−1, recomputed per window (period ≤ 500 keeps this cheap).
  const n = period
  const sumX = (n * (n - 1)) / 2
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6
  const denom = n * sumX2 - sumX * sumX
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sumY = 0
    let sumXY = 0
    for (let j = 0; j < n; j++) {
      const y = candles[i - n + 1 + j]!.close
      sumY += y
      sumXY += j * y
    }
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n
    out.push({ time: t(candles[i]!.time), value: intercept + slope * (n - 1) })
  }
  return out
}

/** Volume-weighted moving average: Σ(close·vol)/Σ(vol) over the window — an SMA where each bar
 *  buys its weight with traded volume, so heavy bars pull the average harder. Zero-volume windows
 *  fall back to the plain mean (never a division by zero). */
export function vwma(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let pv = 0
    let vol = 0
    let plain = 0
    for (let j = i - period + 1; j <= i; j++) {
      const v = candles[j]!.volume ?? 0
      pv += candles[j]!.close * v
      vol += v
      plain += candles[j]!.close
    }
    out.push({ time: t(candles[i]!.time), value: vol > 0 ? pv / vol : plain / period })
  }
  return out
}

/** Momentum: `close − close[period ago]` — the rawest rate-of-change read; rising momentum is
 *  acceleration, falling is fading drive (sign alone says less than its direction of change). */
export function momentum(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  const out: LineData[] = []
  for (let i = period; i < candles.length; i++) {
    out.push({ time: t(candles[i]!.time), value: candles[i]!.close - candles[i - period]!.close })
  }
  return out
}

/**
 * TRIX: the rate of change of a TRIPLE-smoothed EMA of the close, in percent — a momentum
 * oscillator that swings around zero and filters short-term noise via the triple smoothing. A
 * cross of zero (or of its own signal line) is the classic tell. Each EMA pass shifts the series
 * forward by `period − 1` bars, so the output starts at candle index `3·(period − 1) + 1`.
 */
export function trix(candles: Candle[], period: number): LineData[] {
  const closes = candles.map((c) => c.close)
  const ema3 = emaValues(emaValues(emaValues(closes, period), period), period)
  if (ema3.length < 2) return []
  const base = 3 * (period - 1) // candle index of ema3[0]
  const out: LineData[] = []
  for (let i = 1; i < ema3.length; i++) {
    const prev = ema3[i - 1]!
    out.push({
      time: t(candles[base + i]!.time),
      value: prev === 0 ? 0 : (100 * (ema3[i]! - prev)) / prev,
    })
  }
  return out
}

/**
 * Detrended Price Oscillator: strips the trend to expose the dominant CYCLE — the close of
 * `⌊period/2⌋+1` bars ago minus the current SMA(period). Because the comparison price is displaced
 * back half a cycle, a steady trend nets to ~0 and only the oscillation around it remains, so peaks
 * and troughs mark cycle highs/lows. NOT a momentum tool (it looks backward by design). Emits once
 * both the SMA window and the displaced bar exist.
 */
export function dpo(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const shift = Math.floor(period / 2) + 1
  const out: LineData[] = []
  for (let i = Math.max(period - 1, shift); i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j]!.close
    out.push({ time: t(candles[i]!.time), value: candles[i - shift]!.close - sum / period })
  }
  return out
}
