import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import {
  adx,
  cci,
  ema,
  hma,
  ichimoku,
  macd,
  momentum,
  rsi,
  stoch,
  vwma,
  williamsR,
} from './indicators'

/**
 * REFERENCE-VALUE verification: every rated indicator recomputed here by a NAIVE, textbook-direct
 * implementation (arrays, no rolling optimizations) and compared to the production math on a
 * deterministic pseudo-random tape. Two independently written implementations agreeing is the
 * check; the production versions carry rolling sums / subtraction-form smoothing that a subtle
 * off-by-one would silently skew. Tolerance is tight (1e-9 relative) — these are the same
 * formulas, not approximations of each other.
 */

/** Deterministic LCG — the same tape on every run, wiggly enough to exercise every branch. */
function tape(n: number): Candle[] {
  let seed = 42
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: Candle[] = []
  let close = 100
  for (let i = 0; i < n; i++) {
    const open = close
    close = Math.max(1, close * (1 + (rnd() - 0.5) * 0.04))
    const hi = Math.max(open, close) * (1 + rnd() * 0.01)
    const lo = Math.min(open, close) * (1 - rnd() * 0.01)
    out.push({
      time: 1_700_000_000 + i * 3600,
      open,
      high: hi,
      low: lo,
      close,
      volume: 5 + rnd() * 10,
    })
  }
  return out
}

const CANDLES = tape(120)
const closes = CANDLES.map((c) => c.close)

const closeTo = (actual: number, expected: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * 1e-9 + 1e-9)
}

/** Naive SMA of a slice ending at `i` (inclusive). */
const sliceMean = (xs: number[], i: number, n: number): number =>
  xs.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n

/** Naive EMA series over values, SMA-seeded — index aligned to values[period-1..]. */
function refEma(xs: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = [sliceMean(xs, period - 1, period)]
  for (let i = period; i < xs.length; i++) out.push(xs[i]! * k + out.at(-1)! * (1 - k))
  return out
}

describe('indicator reference values (independent naive recomputation)', () => {
  test('EMA(26)', () => {
    closeTo(ema(CANDLES, 26).at(-1)!.value, refEma(closes, 26).at(-1)!)
  })

  test('RSI(14) — Wilder smoothing, SMA seed', () => {
    const period = 14
    let g = 0
    let l = 0
    for (let i = 1; i <= period; i++) {
      const d = closes[i]! - closes[i - 1]!
      if (d >= 0) g += d
      else l -= d
    }
    g /= period
    l /= period
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i]! - closes[i - 1]!
      g = (g * (period - 1) + Math.max(d, 0)) / period
      l = (l * (period - 1) + Math.max(-d, 0)) / period
    }
    closeTo(rsi(CANDLES, period).at(-1)!.value, l === 0 ? 100 : 100 - 100 / (1 + g / l))
    for (const p of rsi(CANDLES, period)) {
      expect(p.value).toBeGreaterThanOrEqual(0)
      expect(p.value).toBeLessThanOrEqual(100)
    }
  })

  test('MACD(12,26,9) — EMA difference and its signal EMA', () => {
    const fast = refEma(closes, 12)
    const slow = refEma(closes, 26)
    const line = slow.map((s, i) => fast[i + (fast.length - slow.length)]! - s)
    const signal = refEma(line, 9)
    const m = macd(CANDLES, 12, 26, 9)
    closeTo(m.macd.at(-1)!.value, line.at(-1)!)
    closeTo(m.signal.at(-1)!.value, signal.at(-1)!)
    closeTo(m.histogram.at(-1)!.value, line.at(-1)! - signal.at(-1)!)
  })

  test('Stochastic %K(14,3) / %D(3)', () => {
    const raw: number[] = []
    for (let i = 13; i < CANDLES.length; i++) {
      const win = CANDLES.slice(i - 13, i + 1)
      const hi = Math.max(...win.map((c) => c.high))
      const lo = Math.min(...win.map((c) => c.low))
      raw.push(hi === lo ? 50 : ((CANDLES[i]!.close - lo) / (hi - lo)) * 100)
    }
    const k = sliceMean(raw, raw.length - 1, 3)
    const kSeries = raw
      .map((_, i) => (i >= 2 ? sliceMean(raw, i, 3) : null))
      .filter((v) => v !== null)
    const d = sliceMean(kSeries, kSeries.length - 1, 3)
    const s = stoch(CANDLES, 14, 3, 3)
    closeTo(s.k.at(-1)!.value, k)
    closeTo(s.d.at(-1)!.value, d)
  })

  test('CCI(20) — 0.015 mean-deviation scaling', () => {
    const tp = CANDLES.map((c) => (c.high + c.low + c.close) / 3)
    const i = tp.length - 1
    const mean = sliceMean(tp, i, 20)
    const dev = tp.slice(i - 19, i + 1).reduce((a, x) => a + Math.abs(x - mean), 0) / 20
    closeTo(cci(CANDLES, 20).at(-1)!.value, (tp[i]! - mean) / (0.015 * dev))
  })

  test('Williams %R(14) — bounded −100..0', () => {
    const i = CANDLES.length - 1
    const win = CANDLES.slice(i - 13, i + 1)
    const hi = Math.max(...win.map((c) => c.high))
    const lo = Math.min(...win.map((c) => c.low))
    closeTo(williamsR(CANDLES, 14).at(-1)!.value, (100 * (CANDLES[i]!.close - hi)) / (hi - lo))
    for (const p of williamsR(CANDLES, 14)) {
      expect(p.value).toBeGreaterThanOrEqual(-100)
      expect(p.value).toBeLessThanOrEqual(0)
    }
  })

  test('Momentum(10) — plain close difference', () => {
    closeTo(momentum(CANDLES, 10).at(-1)!.value, closes.at(-1)! - closes.at(-11)!)
  })

  test('VWMA(20) — volume-weighted close mean', () => {
    const i = CANDLES.length - 1
    let pv = 0
    let vol = 0
    for (const c of CANDLES.slice(i - 19, i + 1)) {
      pv += c.close * c.volume!
      vol += c.volume!
    }
    closeTo(vwma(CANDLES, 20).at(-1)!.value, pv / vol)
  })

  test('HMA(9) — WMA(2·WMA(5) − WMA(9), 3)', () => {
    const wma = (xs: number[], n: number): number[] => {
      const out: number[] = []
      for (let i = n - 1; i < xs.length; i++) {
        let s = 0
        for (let j = 0; j < n; j++) s += xs[i - n + 1 + j]! * (j + 1)
        out.push(s / ((n * (n + 1)) / 2))
      }
      return out
    }
    const half = wma(closes, 5)
    const full = wma(closes, 9)
    const off = half.length - full.length
    const diff = full.map((v, i) => 2 * half[i + off]! - v)
    closeTo(hma(CANDLES, 9).at(-1)!.value, wma(diff, 3).at(-1)!)
  })

  test('Ichimoku kijun(26) — midpoint of the 26-bar range', () => {
    const i = CANDLES.length - 1
    const win = CANDLES.slice(i - 25, i + 1)
    const hi = Math.max(...win.map((c) => c.high))
    const lo = Math.min(...win.map((c) => c.low))
    closeTo(ichimoku(CANDLES, 9, 26, 52).kijun.at(-1)!.value, (hi + lo) / 2)
  })

  test('ADX(14) — Wilder DM/TR smoothing, DX averaged then Wilder-smoothed', () => {
    const period = 14
    let tr = 0
    let plus = 0
    let minus = 0
    const step = (i: number) => {
      const c = CANDLES[i]!
      const p = CANDLES[i - 1]!
      const up = c.high - p.high
      const down = p.low - c.low
      return {
        tr: Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)),
        plus: up > down && up > 0 ? up : 0,
        minus: down > up && down > 0 ? down : 0,
      }
    }
    for (let i = 1; i <= period; i++) {
      const s = step(i)
      tr += s.tr
      plus += s.plus
      minus += s.minus
    }
    const dx: number[] = []
    const record = () => {
      const pdi = (100 * plus) / tr
      const mdi = (100 * minus) / tr
      dx.push(pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi))
    }
    record()
    for (let i = period + 1; i < CANDLES.length; i++) {
      const s = step(i)
      tr = tr - tr / period + s.tr
      plus = plus - plus / period + s.plus
      minus = minus - minus / period + s.minus
      record()
    }
    let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period
    for (let i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]!) / period
    const a = adx(CANDLES, period)
    closeTo(a.adx.at(-1)!.value, value)
    // +DI/−DI last values against the same smoothed sums.
    closeTo(a.plusDi.at(-1)!.value, (100 * plus) / tr)
    closeTo(a.minusDi.at(-1)!.value, (100 * minus) / tr)
  })
})
