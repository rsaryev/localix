import type { HistogramData, LineData, UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { ema } from './indicator-averages'
import { atr } from './indicator-bands'
import { emaValues, t, wmaValues } from './indicator-math'
/**
 * Trend systems: the indicators that answer "which way, and is it holding".
 *
 * These carry their own colours, unlike the averages — a Supertrend flip and a MACD histogram
 * sign are the reading, so the palette is part of the indicator rather than of the chart.
 */

/** MACD (fast/slow EMA difference), its signal EMA, and the divergence histogram. */
export function macd(
  candles: Candle[],
  fast: number,
  slow: number,
  signalPeriod: number,
): { macd: LineData[]; signal: LineData[]; histogram: HistogramData[] } {
  const emaFast = ema(candles, fast)
  const emaSlow = ema(candles, slow)
  if (emaSlow.length === 0 || emaFast.length === 0) return { macd: [], signal: [], histogram: [] }
  // Both EMAs are time-aligned to the candles; the slow one starts later — index from its head.
  const offset = emaFast.length - emaSlow.length
  const line: LineData[] = emaSlow.map((s, i) => ({
    time: s.time,
    value: emaFast[i + offset]!.value - s.value,
  }))

  // Signal: an EMA over the MACD line itself (same seeding rule). Its jth value aligns with
  // `line[signalPeriod − 1 + j]`.
  if (line.length < signalPeriod) return { macd: line, signal: [], histogram: [] }
  const sigOffset = signalPeriod - 1
  const signal: LineData[] = emaValues(
    line.map((p) => p.value),
    signalPeriod,
  ).map((value, j) => ({ time: line[j + sigOffset]!.time, value }))
  const histOffset = line.length - signal.length
  const histogram: HistogramData[] = signal.map((s, i) => {
    const diff = line[i + histOffset]!.value - s.value
    return { time: s.time, value: diff, color: diff >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN }
  })
  return { macd: line, signal, histogram }
}

// The MACD histogram tints, exported for the spec factory in `indicatorSpecs.ts` (and its tests).
export const MACD_HIST_UP = '#26a69a66'

export const MACD_HIST_DOWN = '#ef535066'

// SuperTrend per-point tints — full-strength (a trend line is the foreground, unlike the
// background histograms above), same up/down hues as the candle convention.
export const SUPERTREND_UP = '#26a69a'

export const SUPERTREND_DOWN = '#ef5350'

/**
 * SuperTrend: ATR(period)·mult bands around the median price, flipping between the lower band
 * (uptrend, price above) and the upper band (downtrend, price below), with the standard
 * band-ratchet recursion. ONE line with a per-point color (`SUPERTREND_UP`/`DOWN`) instead of two
 * series — v5 `LineData.color` keeps the engine, feed path, and legend trivial.
 */
export function supertrend(candles: Candle[], period: number, mult: number): LineData[] {
  const atrLine = atr(candles, period)
  if (atrLine.length === 0) return []
  const start = candles.length - atrLine.length // index of the first bar with an ATR value
  const out: LineData[] = []
  let upper = 0
  let lower = 0
  let up = true
  for (let j = 0; j < atrLine.length; j++) {
    const i = start + j
    const c = candles[i]!
    const mid = (c.high + c.low) / 2
    const width = atrLine[j]!.value * mult
    const rawUpper = mid + width
    const rawLower = mid - width
    if (j === 0) {
      upper = rawUpper
      lower = rawLower
      up = c.close >= mid
    } else {
      const prevClose = candles[i - 1]!.close
      // Ratchet: in an uptrend the lower band never loosens (and vice versa) unless price
      // closed beyond the previous band — the standard SuperTrend recursion.
      lower = prevClose > lower ? Math.max(rawLower, lower) : rawLower
      upper = prevClose < upper ? Math.min(rawUpper, upper) : rawUpper
      if (up && c.close < lower) up = false
      else if (!up && c.close > upper) up = true
    }
    out.push({
      time: t(c.time),
      value: up ? lower : upper,
      color: up ? SUPERTREND_UP : SUPERTREND_DOWN,
    })
  }
  return out
}

/** Aroon up/down: bars since the window's high/low, scaled to 0–100 (100 = this bar). */
export function aroon(candles: Candle[], period: number): { up: LineData[]; down: LineData[] } {
  if (period < 1 || candles.length < period + 1) return { up: [], down: [] }
  const up: LineData[] = []
  const down: LineData[] = []
  for (let i = period; i < candles.length; i++) {
    // `>=`/`<=` favour the MOST RECENT extreme, per Aroon's definition.
    let hiIdx = i - period
    let loIdx = i - period
    for (let j = i - period; j <= i; j++) {
      if (candles[j]!.high >= candles[hiIdx]!.high) hiIdx = j
      if (candles[j]!.low <= candles[loIdx]!.low) loIdx = j
    }
    up.push({ time: t(candles[i]!.time), value: (100 * (period - (i - hiIdx))) / period })
    down.push({ time: t(candles[i]!.time), value: (100 * (period - (i - loIdx))) / period })
  }
  return { up, down }
}

/**
 * Ichimoku Cloud. Tenkan/Kijun are window-midpoint lines on their own bars; Senkou A/B are
 * plotted `kijun` bars into the FUTURE (times projected at the candles' own spacing — the chart
 * has no bars there yet); Chikou is the close plotted `kijun` bars into the past. All five
 * follow the honesty rule: a line starts only where its full lookback exists.
 */
export function ichimoku(
  candles: Candle[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouPeriod: number,
): {
  tenkan: LineData[]
  kijun: LineData[]
  spanA: LineData[]
  spanB: LineData[]
  chikou: LineData[]
} {
  const empty = { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }
  if (candles.length < 2) return empty
  const midpoint = (period: number): LineData[] => {
    if (candles.length < period) return []
    const out: LineData[] = []
    for (let i = period - 1; i < candles.length; i++) {
      let hi = -Infinity
      let lo = Infinity
      for (let j = i - period + 1; j <= i; j++) {
        hi = Math.max(hi, candles[j]!.high)
        lo = Math.min(lo, candles[j]!.low)
      }
      out.push({ time: t(candles[i]!.time), value: (hi + lo) / 2 })
    }
    return out
  }
  const tenkan = midpoint(tenkanPeriod)
  const kijun = midpoint(kijunPeriod)

  // Bar spacing for projecting future times — the spacing of the LAST pair (candles are evenly
  // spaced within a timeframe; the newest pair cannot straddle an old gap that has since filled).
  const interval = candles[candles.length - 1]!.time - candles[candles.length - 2]!.time
  const timeAt = (index: number): UTCTimestamp => {
    const last = candles.length - 1
    return index <= last
      ? t(candles[index]!.time)
      : t(candles[last]!.time + (index - last) * interval)
  }
  const shiftForward = (line: LineData[], startIndex: number): LineData[] =>
    line.map((p, i) => ({ value: p.value, time: timeAt(startIndex + i + kijunPeriod) }))

  // Span A exists where BOTH tenkan and kijun do (kijun starts later when kijun ≥ tenkan).
  const spanAOffset = tenkan.length - kijun.length
  const spanARaw: LineData[] = kijun.map((kp, i) => ({
    time: kp.time,
    value: (tenkan[i + spanAOffset]!.value + kp.value) / 2,
  }))
  const spanBRaw = midpoint(senkouPeriod)
  const spanA = shiftForward(spanARaw, candles.length - spanARaw.length)
  const spanB = shiftForward(spanBRaw, candles.length - spanBRaw.length)

  // Chikou: today's close on the bar `kijun` steps back — the head is simply cut off.
  const chikou: LineData[] = []
  for (let i = kijunPeriod; i < candles.length; i++) {
    chikou.push({ time: t(candles[i - kijunPeriod]!.time), value: candles[i]!.close })
  }
  return { tenkan, kijun, spanA, spanB, chikou }
}

/**
 * ADX / DMI (Wilder): +DI/−DI from smoothed directional movement over smoothed TR, ADX as the
 * Wilder-smoothed average of the DX series. +DI/−DI emit from index `period`; ADX seeds over the
 * first `period` DX values, so its first point lands on index `2·period − 1` — three
 * honestly-staggered heads, not one warped one.
 */
export function adx(
  candles: Candle[],
  period: number,
): { adx: LineData[]; plusDi: LineData[]; minusDi: LineData[] } {
  if (period < 1 || candles.length < period + 1) return { adx: [], plusDi: [], minusDi: [] }
  let trSum = 0
  let plusSum = 0
  let minusSum = 0
  const step = (i: number): { tr: number; plus: number; minus: number } => {
    const c = candles[i]!
    const p = candles[i - 1]!
    const upMove = c.high - p.high
    const downMove = p.low - c.low
    return {
      tr: Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)),
      plus: upMove > downMove && upMove > 0 ? upMove : 0,
      minus: downMove > upMove && downMove > 0 ? downMove : 0,
    }
  }
  for (let i = 1; i <= period; i++) {
    const s = step(i)
    trSum += s.tr
    plusSum += s.plus
    minusSum += s.minus
  }
  const plusDi: LineData[] = []
  const minusDi: LineData[] = []
  const dx: LineData[] = []
  const emit = (i: number) => {
    const pdi = trSum === 0 ? 0 : (100 * plusSum) / trSum
    const mdi = trSum === 0 ? 0 : (100 * minusSum) / trSum
    plusDi.push({ time: t(candles[i]!.time), value: pdi })
    minusDi.push({ time: t(candles[i]!.time), value: mdi })
    const sum = pdi + mdi
    dx.push({ time: t(candles[i]!.time), value: sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum })
  }
  emit(period)
  for (let i = period + 1; i < candles.length; i++) {
    const s = step(i)
    // Wilder's smoothing in its subtraction form: S = S − S/n + x.
    trSum = trSum - trSum / period + s.tr
    plusSum = plusSum - plusSum / period + s.plus
    minusSum = minusSum - minusSum / period + s.minus
    emit(i)
  }
  if (dx.length < period) return { adx: [], plusDi, minusDi }
  let adxValue = 0
  for (let i = 0; i < period; i++) adxValue += dx[i]!.value
  adxValue /= period
  const adxLine: LineData[] = [{ time: dx[period - 1]!.time, value: adxValue }]
  for (let i = period; i < dx.length; i++) {
    adxValue = (adxValue * (period - 1) + dx[i]!.value) / period
    adxLine.push({ time: dx[i]!.time, value: adxValue })
  }
  return { adx: adxLine, plusDi, minusDi }
}

/**
 * Know Sure Thing (Pring): a smoothed momentum oscillator — a weighted sum of four SMA-smoothed
 * rates of change (ROC 10/15/20/30, each SMA-smoothed, weighted 1/2/3/4 so the slower cycles
 * dominate). Zero crossings and turns signal shifts in the broad momentum. Pring's fixed periods,
 * so parameterless; emits once the longest window (ROC 30 + SMA 15) exists.
 */
export function kst(candles: Candle[]): LineData[] {
  const closes = candles.map((c) => c.close)
  const rocmaAt = (i: number, rocLen: number, smaLen: number): number => {
    let sum = 0
    for (let j = i - smaLen + 1; j <= i; j++) sum += (closes[j]! / closes[j - rocLen]! - 1) * 100
    return sum / smaLen
  }
  const start = Math.max(10 + 10, 15 + 10, 20 + 10, 30 + 15) - 1 // 44
  if (closes.length <= start) return []
  const out: LineData[] = []
  for (let i = start; i < closes.length; i++) {
    out.push({
      time: t(candles[i]!.time),
      value:
        rocmaAt(i, 10, 10) +
        2 * rocmaAt(i, 15, 10) +
        3 * rocmaAt(i, 20, 10) +
        4 * rocmaAt(i, 30, 15),
    })
  }
  return out
}

/**
 * Coppock Curve: a smoothed momentum turn signal — WMA(10) of the sum of two rates of change
 * (14- and 11-bar). Designed for long horizons (Coppock built it on monthly data), it flags a
 * bottoming when it turns up from below zero. Periods are the author's fixed 14/11/10, so it is
 * parameterless. Emits once both the ROC lookback and the WMA window exist.
 */
export function coppock(candles: Candle[]): LineData[] {
  const ROC_LONG = 14
  const ROC_SHORT = 11
  const WMA_LEN = 10
  const closes = candles.map((c) => c.close)
  if (closes.length <= ROC_LONG) return []
  const rocSum: number[] = []
  for (let i = ROC_LONG; i < closes.length; i++) {
    rocSum.push(
      (closes[i]! / closes[i - ROC_LONG]! - 1) * 100 +
        (closes[i]! / closes[i - ROC_SHORT]! - 1) * 100,
    )
  }
  const wma = wmaValues(rocSum, WMA_LEN)
  const start = candles.length - wma.length
  return wma.map((value, j) => ({ time: t(candles[start + j]!.time), value }))
}
