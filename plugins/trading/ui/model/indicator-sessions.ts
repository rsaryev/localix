import type { LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { t } from './indicator-math'

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
