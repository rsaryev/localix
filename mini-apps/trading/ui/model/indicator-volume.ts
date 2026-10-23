import type { LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { emaValues, t } from './indicator-math'
/**
 * Volume-weighted accumulation: what the tape says about where price went.
 *
 * Every one of these reads `volume` and would be meaningless without it, which is the cleanest
 * line that can be drawn through this catalogue.
 */

/**
 * On-balance volume: cumulative volume signed by the close-to-close direction. The first DELTA
 * needs two bars, so it emits from index 1 (seeded at 0 there — OBV's level is arbitrary, only
 * its slope means anything). Bars without volume add 0.
 */
export function obv(candles: Candle[]): LineData[] {
  if (candles.length < 2) return []
  const out: LineData[] = []
  let value = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!
    const d = c.close - candles[i - 1]!.close
    const v = c.volume ?? 0
    if (d > 0) value += v
    else if (d < 0) value -= v
    out.push({ time: t(c.time), value })
  }
  return out
}

/** Chaikin money flow: Σ(money-flow volume)/Σ(volume) over the window; volume-less windows read 0. */
export function cmf(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period) return []
  const mfv = candles.map((c) => {
    const range = c.high - c.low
    const v = c.volume ?? 0
    return range === 0 ? 0 : ((c.close - c.low - (c.high - c.close)) / range) * v
  })
  const out: LineData[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let flow = 0
    let vol = 0
    for (let j = i - period + 1; j <= i; j++) {
      flow += mfv[j]!
      vol += candles[j]!.volume ?? 0
    }
    out.push({ time: t(candles[i]!.time), value: vol === 0 ? 0 : flow / vol })
  }
  return out
}

/**
 * Klinger Volume Oscillator: volume force (volume signed by the trend of the typical price and
 * scaled by where the bar's range sits in a running cumulative measure) run through the difference
 * of a fast EMA(34) and a slow EMA(55). It aims to track long-term money flow while staying
 * sensitive to short-term reversals; zero crossings flag flow shifts. Klinger's fixed periods, so
 * parameterless; emits once the slow EMA window exists.
 */
export function klinger(candles: Candle[]): LineData[] {
  const FAST = 34
  const SLOW = 55
  if (candles.length < SLOW + 1) return []
  const vf: number[] = []
  let prevTrend = 0
  let prevCm = 0
  let prevDm = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!
    const p = candles[i - 1]!
    const trend = c.high + c.low + c.close > p.high + p.low + p.close ? 1 : -1
    const dm = c.high - c.low
    const cm = trend === prevTrend ? prevCm + dm : prevDm + dm
    vf.push(cm !== 0 ? (c.volume ?? 0) * Math.abs(2 * (dm / cm) - 1) * trend * 100 : 0)
    prevTrend = trend
    prevCm = cm
    prevDm = dm
  }
  const emaFast = emaValues(vf, FAST)
  const emaSlow = emaValues(vf, SLOW)
  const offset = emaFast.length - emaSlow.length // = SLOW − FAST
  const start = candles.length - emaSlow.length
  return emaSlow.map((s, j) => ({
    time: t(candles[start + j]!.time),
    value: emaFast[j + offset]! - s,
  }))
}

/**
 * Ease of Movement (Arms): how FAR the midpoint moved per unit of volume-pressure — a large move on
 * light volume is "easy" (a big positive/negative reading), a small move on heavy volume "hard"
 * (near zero). `midMove / boxRatio`, SMA(period)-smoothed, where boxRatio = (volume/scale)/range.
 * The scale (10 000, matching common charting defaults) is arbitrary, so the SIGN and shape carry
 * the signal, not the absolute level. Volume-less bars contribute 0.
 */
export function easeOfMovement(candles: Candle[], period: number): LineData[] {
  const SCALE = 10_000
  if (period < 1 || candles.length < period + 1) return []
  const emv1: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!
    const p = candles[i - 1]!
    const midMove = (c.high + c.low) / 2 - (p.high + p.low) / 2
    const range = c.high - c.low
    const vol = c.volume ?? 0
    const boxRatio = vol > 0 ? vol / SCALE / (range || 1) : 0
    emv1.push(boxRatio !== 0 ? midMove / boxRatio : 0)
  }
  const out: LineData[] = []
  for (let i = period - 1; i < emv1.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += emv1[j]!
    out.push({ time: t(candles[i + 1]!.time), value: sum / period })
  }
  return out
}

/**
 * Elder's Force Index: the raw force of each move — `(close − prevClose) × volume` — smoothed by an
 * EMA(period). It fuses direction, magnitude AND participation: a big up-move on heavy volume is a
 * strong positive force, a drift up on thin volume a weak one. Zero crossings flag the balance of
 * power flipping. The first raw force needs the previous close, so the EMA seeds over bars
 * `1..period` and the first point lands on index `period` — the honesty rule shared with `atr`.
 */
export function forceIndex(candles: Candle[], period: number): LineData[] {
  if (period < 1 || candles.length < period + 1) return []
  const raw: number[] = []
  for (let i = 1; i < candles.length; i++) {
    raw.push((candles[i]!.close - candles[i - 1]!.close) * (candles[i]!.volume ?? 0))
  }
  // raw[i] is the force of candle i+1; the EMA's first point (SMA of raw[0..period-1]) lands on
  // candle `period`, so the jth EMA value maps to candle `period + j`.
  return emaValues(raw, period).map((value, j) => ({ time: t(candles[period + j]!.time), value }))
}

/**
 * Accumulation/Distribution line: cumulative volume weighted by WHERE the close sits in the bar's
 * range — a close near the high accumulates (buyers in control), near the low distributes. The
 * money-flow multiplier is `((close−low) − (high−close)) / (high−low)`, in −1..1; a rangeless bar
 * (high == low) contributes 0. Emits from the first bar; like OBV its level is arbitrary, only the
 * slope (and its divergence from price) means anything. Volume-less bars add 0.
 */
export function accumDist(candles: Candle[]): LineData[] {
  const out: LineData[] = []
  let value = 0
  for (const c of candles) {
    const range = c.high - c.low
    const mfm = range > 0 ? (c.close - c.low - (c.high - c.close)) / range : 0
    value += mfm * (c.volume ?? 0)
    out.push({ time: t(c.time), value })
  }
  return out
}
