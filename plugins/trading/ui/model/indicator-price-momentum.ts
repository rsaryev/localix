import type { HistogramData, LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { emaValues, t } from './indicator-math'

/** Momentum series expressed in price units, rather than a bounded oscillator range. */
// AO histogram tints — rising/falling vs the previous bar, mirroring the volume convention.
export const AO_UP = '#26a69a99'

export const AO_DOWN = '#ef535099'

/** Awesome Oscillator: SMA(5) − SMA(34) of the median price, colored by rise/fall. */
export function ao(candles: Candle[]): HistogramData[] {
  const FAST = 5
  const SLOW = 34
  if (candles.length < SLOW) return []
  const median = candles.map((c) => (c.high + c.low) / 2)
  const smaAt = (i: number, period: number): number => {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += median[j]!
    return sum / period
  }
  const out: HistogramData[] = []
  let prev = Number.NaN
  for (let i = SLOW - 1; i < candles.length; i++) {
    const value = smaAt(i, FAST) - smaAt(i, SLOW)
    out.push({
      time: t(candles[i]!.time),
      value,
      color: Number.isNaN(prev) || value >= prev ? AO_UP : AO_DOWN,
    })
    prev = value
  }
  return out
}

/**
 * Elder-Ray Bull/Bear Power, combined: `(high − EMA(period)) + (low − EMA(period))` — how far the
 * bar's extremes stretch around the consensus EMA(13). Positive = bulls in control of the bar's
 * range, negative = bears; the CHANGE (weakening bear power under a rising trend) is the classic
 * entry tell.
 */
export function bullBearPower(candles: Candle[], period = 13): LineData[] {
  const { bull, bear } = elderRay(candles, period)
  return bull.map((p, i) => ({ time: p.time, value: p.value + bear[i]!.value }))
}

/**
 * Elder-Ray, DECOMPOSED — `bull = high − EMA(period)`, `bear = low − EMA(period)`, and the trend
 * EMA itself. The combined figure above is what a chart plots, but Elder's own entry rules
 * (Trading for a Living, 1993) read the two halves SEPARATELY against the trend: buy when the
 * EMA is rising while bear power is still negative but recovering, sell when the EMA is falling
 * while bull power is still positive but fading. The rating table needs those parts; the combined
 * series is built from them so one math serves both.
 */
export function elderRay(
  candles: Candle[],
  period = 13,
): { bull: LineData[]; bear: LineData[]; trend: LineData[] } {
  const closes = candles.map((c) => c.close)
  const emas = emaValues(closes, period)
  if (emas.length === 0) return { bull: [], bear: [], trend: [] }
  const base = period - 1 // candle index of emas[0]
  const bull: LineData[] = []
  const bear: LineData[] = []
  const trend: LineData[] = []
  for (let i = 0; i < emas.length; i++) {
    const c = candles[base + i]!
    const time = t(c.time)
    bull.push({ time, value: c.high - emas[i]! })
    bear.push({ time, value: c.low - emas[i]! })
    trend.push({ time, value: emas[i]! })
  }
  return { bull, bear, trend }
}
