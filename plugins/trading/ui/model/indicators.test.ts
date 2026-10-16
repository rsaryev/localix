import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import {
  SUPERTREND_DOWN,
  SUPERTREND_UP,
  adx,
  atr,
  bollinger,
  ema,
  macd,
  accumDist,
  coppock,
  dpo,
  easeOfMovement,
  envelopes,
  fisher,
  historicalVol,
  klinger,
  kst,
  forceIndex,
  obv,
  rsi,
  stoch,
  supertrend,
  pivotSeries,
  vwap,
  vwapBands,
  williamsR,
  trix,
  momentum,
  vwma,
  bullBearPower,
  ultimateOscillator,
  stochRsi,
} from './indicators'
import { INDICATORS } from './indicatorSpecs'
import { mustFind, namedBody, readCode } from '@localixai/source-lint'

const bar = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
})
const bars = (...closes: number[]) => closes.map((c, i) => bar(i + 1, c))

describe('ema', () => {
  test('seeds with the SMA of the first period, then recurses', () => {
    // period 3, closes 10/20/30/40: seed (10+20+30)/3 = 20 at t3, then 40·0.5 + 20·0.5 = 30 at t4.
    expect(ema(bars(10, 20, 30, 40), 3).map((p) => [Number(p.time), p.value])).toEqual([
      [3, 20],
      [4, 30],
    ])
  })

  test('no warped head — nothing before `period` closes exist', () => {
    expect(ema(bars(10, 20), 3)).toEqual([])
    expect(ema([], 3)).toEqual([])
  })

  test('a flat series is a flat line', () => {
    for (const p of ema(bars(5, 5, 5, 5, 5), 2)) expect(p.value).toBe(5)
  })
})

describe('rsi', () => {
  test('needs period+1 bars, then emits from the first full window', () => {
    expect(rsi(bars(1, 2, 3), 3)).toEqual([])
    const line = rsi(bars(1, 2, 3, 4), 3)
    expect(line).toHaveLength(1)
    expect(Number(line[0]!.time)).toBe(4)
  })

  test('all gains read 100, all losses 0', () => {
    expect(rsi(bars(1, 2, 3, 4, 5), 3).every((p) => p.value === 100)).toBe(true)
    expect(rsi(bars(5, 4, 3, 2, 1), 3).every((p) => p.value === 0)).toBe(true)
  })

  test('a seed window whose gains equal its losses opens at 50', () => {
    // Deltas +1, −1, +1, −1: average gain = average loss → RS = 1 → RSI = 50.
    const line = rsi(bars(10, 11, 10, 11, 10), 4)
    expect(line[0]!.value).toBeCloseTo(50, 10)
  })
})

describe('bollinger', () => {
  test('bands are the basis ± mult standard deviations, time-aligned to the basis', () => {
    // window [10, 20]: mean 15, population σ 5 → ±2σ = 15 ± 10.
    const { basis, upper, lower } = bollinger(bars(10, 20), 2, 2)
    expect(basis.map((p) => p.value)).toEqual([15])
    expect(upper.map((p) => p.value)).toEqual([25])
    expect(lower.map((p) => p.value)).toEqual([5])
    expect(Number(upper[0]!.time)).toBe(2)
  })

  test('a flat window has zero width', () => {
    const { basis, upper, lower } = bollinger(bars(7, 7, 7), 3, 2)
    expect(upper[0]!.value).toBe(basis[0]!.value)
    expect(lower[0]!.value).toBe(basis[0]!.value)
  })
})

describe('macd', () => {
  test('the macd line is emaFast − emaSlow, aligned to the slow head', () => {
    const series = bars(1, 2, 3, 4, 5, 6)
    const { macd: line } = macd(series, 2, 4, 9)
    const fast = ema(series, 2)
    const slow = ema(series, 4)
    expect(line).toHaveLength(slow.length)
    expect(Number(line[0]!.time)).toBe(Number(slow[0]!.time))
    const offset = fast.length - slow.length
    line.forEach((p, i) =>
      expect(p.value).toBeCloseTo(fast[i + offset]!.value - slow[i]!.value, 10),
    )
  })

  test('the histogram is macd − signal, colored by sign', () => {
    const series = bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5)
    const { macd: line, signal, histogram } = macd(series, 2, 4, 3)
    expect(histogram).toHaveLength(signal.length)
    const offset = line.length - signal.length
    histogram.forEach((h, i) => {
      const expected = line[i + offset]!.value - signal[i]!.value
      expect(h.value).toBeCloseTo(expected, 10)
      expect(h.color).toBe(expected >= 0 ? '#26a69a66' : '#ef535066')
    })
    // A rising then falling series crosses: both tints must actually occur.
    expect(new Set(histogram.map((h) => h.color)).size).toBe(2)
  })

  test('too little history yields empty arrays, never a partial signal', () => {
    expect(macd(bars(1, 2, 3), 12, 26, 9)).toEqual({ macd: [], signal: [], histogram: [] })
  })
})

/** A bar with a real high/low range (the flat `bar` helper can't exercise TR/stochastics). */
const ohlc = (time: number, low: number, high: number, close: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 1,
})

describe('atr', () => {
  test('seeds over bars 1..period and lands the first point on index `period`', () => {
    // Flat-range bars: TR = |close − prevClose| = 2 everywhere.
    const line = atr(bars(10, 12, 14, 16), 2)
    expect(line.map((p) => [Number(p.time), p.value])).toEqual([
      [3, 2],
      [4, 2],
    ])
    expect(atr(bars(10, 12), 2)).toEqual([])
  })

  test('true range takes the largest of the three candidates', () => {
    // Gap up: high−low = 2, but |high − prevClose| = 12 dominates.
    const line = atr([ohlc(1, 9, 11, 10), ohlc(2, 20, 22, 21)], 1)
    expect(line[0]!.value).toBe(12)
  })
})

describe('vwap', () => {
  test('cumulative typical·volume over volume, from the first bar', () => {
    // Flat bars, volume 1: typical = close → running average of the closes.
    expect(vwap(bars(10, 20)).map((p) => p.value)).toEqual([10, 15])
  })

  test('resets at the UTC-day boundary', () => {
    const line = vwap([bar(86_399, 10), bar(86_400, 30), bar(86_401, 50)])
    expect(line.map((p) => p.value)).toEqual([10, 30, 40]) // day 2 forgets the 10
  })

  test('volume-less bars carry no weight; an all-volumeless day emits nothing', () => {
    const noVol = (time: number, close: number): Candle => ({
      time,
      open: close,
      high: close,
      low: close,
      close,
    })
    expect(vwap([noVol(1, 10), noVol(2, 20)])).toEqual([])
    // A volumeless bar mid-day keeps the previous ratio (weight 0), it does not skew it.
    const line = vwap([bar(1, 10), noVol(2, 999), bar(3, 20)])
    expect(line.map((p) => p.value)).toEqual([10, 10, 15])
  })
})

describe('pivotSeries', () => {
  const DAY = 86_400
  const hlc = (time: number, high: number, low: number, close: number): Candle => ({
    time,
    open: close,
    high,
    low,
    close,
    volume: 1,
  })

  test('each bar carries its day pivots, derived from the prior day HLC', () => {
    const candles = [
      hlc(0, 110, 90, 100), // day 0: H110 L90 C100 → PP 100
      hlc(DAY, 101, 99, 100), // day 1 bar
      hlc(DAY + 3600, 102, 98, 101), // still day 1
    ]
    const p = pivotSeries(candles)
    // Day 0 has no prior day → no points; both day-1 bars carry day-0's pivots.
    expect(p.pp.map((x) => x.value)).toEqual([100, 100])
    expect(p.r1.map((x) => x.value)).toEqual([110, 110]) // 2·100 − 90
    expect(p.s1.map((x) => x.value)).toEqual([90, 90]) // 2·100 − 110
    expect(p.r2[0]!.value).toBeCloseTo(120, 5) // 100 + 20
    expect(p.s2[0]!.value).toBeCloseTo(80, 5)
  })

  test('emits nothing until a prior day exists', () => {
    expect(pivotSeries([hlc(0, 110, 90, 100), hlc(3600, 108, 98, 101)]).pp).toEqual([])
  })
})

describe('vwapBands', () => {
  test('basis is the VWAP; the bands are ±mult volume-weighted σ of the typical price', () => {
    // Closes 10, 20 (volume 1): bar 2 has mean 15, variance E[tp²]-mean² = 250-225 = 25, σ = 5.
    const { basis, upper, lower } = vwapBands(bars(10, 20), 2)
    expect(basis.map((p) => p.value)).toEqual([10, 15])
    expect(upper.map((p) => p.value)).toEqual([10, 25]) // 15 + 2·5
    expect(lower.map((p) => p.value)).toEqual([10, 5]) // 15 − 2·5
  })

  test('upper ≥ basis ≥ lower on every emitted bar, and it resets per UTC day', () => {
    const { basis, upper, lower } = vwapBands(
      [bar(86_399, 10), bar(86_400, 30), bar(86_401, 50)],
      2,
    )
    // Day 2 forgets day 1: basis restarts at 30 (same reset rule as vwap).
    expect(basis.map((p) => p.value)).toEqual([10, 30, 40])
    for (let i = 0; i < basis.length; i++) {
      expect(upper[i]!.value).toBeGreaterThanOrEqual(basis[i]!.value)
      expect(lower[i]!.value).toBeLessThanOrEqual(basis[i]!.value)
    }
  })
})

describe('supertrend', () => {
  const rising = bars(...Array.from({ length: 30 }, (_, i) => 100 + i * 2))
  const crash = bars(
    ...Array.from({ length: 15 }, (_, i) => 100 + i * 2),
    ...Array.from({ length: 15 }, (_, i) => 128 - i * 6),
  )

  test('a steady uptrend rides the lower band, colored up, below price', () => {
    const line = supertrend(rising, 10, 3)
    expect(line.length).toBeGreaterThan(0)
    for (const [j, p] of line.entries()) {
      expect(p.color).toBe(SUPERTREND_UP)
      const barIdx = rising.length - line.length + j
      expect(p.value).toBeLessThan(rising[barIdx]!.close)
    }
  })

  test('a crash flips the trend to down (both tints occur, band above price after the flip)', () => {
    const line = supertrend(crash, 5, 1)
    const colors = new Set(line.map((p) => p.color))
    expect(colors.has(SUPERTREND_UP)).toBe(true)
    expect(colors.has(SUPERTREND_DOWN)).toBe(true)
    const last = line[line.length - 1]!
    expect(last.color).toBe(SUPERTREND_DOWN)
    expect(last.value).toBeGreaterThan(crash[crash.length - 1]!.close)
  })

  test('too little history is empty, never a warped head', () => {
    expect(supertrend(bars(1, 2, 3), 10, 3)).toEqual([])
  })
})

describe('stoch', () => {
  test('%K is the close position in the k-bar range, SMA-smoothed; %D smooths %K', () => {
    const series = [ohlc(1, 0, 10, 5), ohlc(2, 0, 10, 10), ohlc(3, 0, 10, 0), ohlc(4, 0, 10, 10)]
    // k=2 raw: t2 close 10 of [0,10] → 100; t3 → 0; t4 → 100. kSmooth=1 keeps them.
    const { k, d } = stoch(series, 2, 1, 2)
    expect(k.map((p) => [Number(p.time), p.value])).toEqual([
      [2, 100],
      [3, 0],
      [4, 100],
    ])
    // %D = SMA(2) of %K: (100+0)/2=50 at t3, (0+100)/2=50 at t4.
    expect(d.map((p) => [Number(p.time), p.value])).toEqual([
      [3, 50],
      [4, 50],
    ])
  })

  test('a flat window reads 50, not a division by zero', () => {
    const { k } = stoch(bars(5, 5, 5), 2, 1, 1)
    expect(k.every((p) => p.value === 50)).toBe(true)
  })

  test('honesty: %K starts at index k+kSmooth−2', () => {
    const series = bars(...Array.from({ length: 20 }, (_, i) => 100 + i))
    const { k } = stoch(series, 14, 3, 3)
    expect(Number(k[0]!.time)).toBe(Number(series[14 + 3 - 2]!.time))
  })
})

describe('williamsR', () => {
  test('scales the close within the range to −100..0 (inverted %K)', () => {
    const series = [ohlc(1, 0, 10, 5), ohlc(2, 0, 10, 10), ohlc(3, 0, 10, 0), ohlc(4, 0, 10, 10)]
    // period 2: close at the top of the range → 0, at the bottom → −100.
    expect(williamsR(series, 2).map((p) => [Number(p.time), p.value])).toEqual([
      [2, 0],
      [3, -100],
      [4, 0],
    ])
  })

  test('a flat window reads −50, not a division by zero', () => {
    expect(williamsR(bars(5, 5, 5), 2).every((p) => p.value === -50)).toBe(true)
  })
})

describe('momentum', () => {
  test('is close minus the close period bars ago', () => {
    const out = momentum(bars(100, 101, 103, 106), 2)
    expect(out.map((p) => [Number(p.time), p.value])).toEqual([
      [3, 3], // 103 − 100
      [4, 5], // 106 − 101
    ])
  })
})

describe('vwma', () => {
  test('weights each close by its volume', () => {
    // closes 100 (vol 1) and 110 (vol 3) → (100 + 330)/4 = 107.5.
    const series = [
      { ...bar(1, 100), volume: 1 },
      { ...bar(2, 110), volume: 3 },
    ]
    expect(vwma(series, 2)[0]!.value).toBeCloseTo(107.5, 10)
  })

  test('falls back to the plain mean on a zero-volume window', () => {
    const series = [
      { ...bar(1, 100), volume: 0 },
      { ...bar(2, 110), volume: 0 },
    ]
    expect(vwma(series, 2)[0]!.value).toBeCloseTo(105, 10)
  })
})

describe('bullBearPower', () => {
  test('sums the bar extremes around the EMA', () => {
    // Flat closes at 100 → EMA 100. Bar high 104, low 98 → BBP (104−100)+(98−100) = 2.
    const series = [...bars(100, 100, 100), ohlc(4, 98, 104, 100)]
    const out = bullBearPower(series, 3)
    expect(out.at(-1)!.value).toBeCloseTo(4 + -2, 5)
  })
})

describe('ultimateOscillator', () => {
  test('reads mid-scale on a steady drift and stays within 0–100', () => {
    const series = bars(...Array.from({ length: 40 }, (_, i) => 100 + i * 0.5))
    const out = ultimateOscillator(series, 3, 6, 12)
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      expect(p.value).toBeGreaterThanOrEqual(0)
      expect(p.value).toBeLessThanOrEqual(100)
    }
    // A monotonic rise keeps buying pressure high — the blend sits above 50.
    expect(out.at(-1)!.value).toBeGreaterThan(50)
  })
})

describe('stochRsi', () => {
  test('pins to the window extreme after a turn (RSI at its range low → 0)', () => {
    // Rise then fall: the last RSI prints are the lowest of their window → stoch of RSI hits 0.
    const turn = bars(
      ...Array.from({ length: 25 }, (_, i) => 100 + i),
      ...Array.from({ length: 10 }, (_, i) => 124 - (i + 1) * 2),
    )
    const { k } = stochRsi(turn, 5, 5, 1, 1)
    expect(k.at(-1)!.value).toBeCloseTo(0, 5)
    // And the mirror: fall then rise pins to 100.
    const vTurn = bars(
      ...Array.from({ length: 25 }, (_, i) => 200 - i),
      ...Array.from({ length: 10 }, (_, i) => 176 + (i + 1) * 2),
    )
    const { k: k2 } = stochRsi(vTurn, 5, 5, 1, 1)
    expect(k2.at(-1)!.value).toBeCloseTo(100, 5)
  })

  test('%D smooths %K and starts later', () => {
    const series = bars(...Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10))
    const { k, d } = stochRsi(series, 14, 14, 3, 3)
    expect(k.length).toBeGreaterThan(d.length)
  })
})

describe('trix', () => {
  test('is positive on a steadily rising close and starts at 3·(period−1)+1', () => {
    const series = bars(...Array.from({ length: 30 }, (_, i) => 100 + i))
    const out = trix(series, 3)
    expect(out.length).toBeGreaterThan(0)
    // Triple EMA shift = 3·(period−1); the rate-of-change output begins one bar later.
    expect(Number(out[0]!.time)).toBe(Number(series[3 * (3 - 1) + 1]!.time))
    // A monotonically rising series has a rising triple-EMA → TRIX stays above zero.
    expect(out.every((p) => p.value > 0)).toBe(true)
  })

  test('reads zero on a perfectly flat series', () => {
    const out = trix(bars(...Array.from({ length: 20 }, () => 100)), 3)
    expect(out.every((p) => p.value === 0)).toBe(true)
  })
})

describe('obv', () => {
  test('cumulative signed volume from the first delta; flat closes add nothing', () => {
    const series = [bar(1, 10), bar(2, 20), bar(3, 15), bar(4, 15)]
    series.forEach((c, i) => (c.volume = i + 1)) // volumes 1,2,3,4
    expect(obv(series).map((p) => [Number(p.time), p.value])).toEqual([
      [2, 2],
      [3, -1],
      [4, -1],
    ])
    expect(obv([bar(1, 10)])).toEqual([])
  })
})

describe('accumDist', () => {
  test('accumulates on a close near the high, distributes near the low; a flat bar adds 0', () => {
    const c = (time: number, high: number, low: number, close: number, volume: number): Candle => ({
      time,
      open: close,
      high,
      low,
      close,
      volume,
    })
    const series = [
      c(1, 110, 90, 110, 10), // close AT the high → mfm +1 → +10
      c(2, 110, 90, 90, 20), // close AT the low → mfm −1 → −20 (cumulative −10)
      c(3, 110, 90, 100, 30), // close mid-range → mfm 0 → unchanged
      c(4, 100, 100, 100, 50), // rangeless bar → mfm 0 → unchanged
    ]
    expect(accumDist(series).map((p) => [Number(p.time), p.value])).toEqual([
      [1, 10],
      [2, -10],
      [3, -10],
      [4, -10],
    ])
  })
})

describe('envelopes', () => {
  test('bands sit a fixed percent above and below the SMA basis', () => {
    // Flat 100s → SMA 100 → upper 102.5, lower 97.5 at 2.5%.
    const { basis, upper, lower } = envelopes(bars(100, 100, 100), 2, 2.5)
    expect(basis.map((p) => p.value)).toEqual([100, 100])
    upper.forEach((p) => expect(p.value).toBeCloseTo(102.5, 6))
    lower.forEach((p) => expect(p.value).toBeCloseTo(97.5, 6))
  })
})

describe('easeOfMovement', () => {
  test('positive when the midpoint rises on light volume; emits from index period', () => {
    const c = (i: number, mid: number): Candle => ({
      time: 1_700_000_000 + i * 3600,
      open: mid,
      high: mid + 1,
      low: mid - 1,
      close: mid,
      volume: 5,
    })
    const rising = Array.from({ length: 20 }, (_, i) => c(i, 100 + i))
    const line = easeOfMovement(rising, 14)
    expect(line).toHaveLength(20 - 14)
    expect(Number(line[0]!.time)).toBe(Number(rising[14]!.time))
    expect(line.at(-1)!.value).toBeGreaterThan(0)
  })

  test('too little history yields an empty line', () => {
    expect(easeOfMovement(bars(1, 2), 14)).toEqual([])
  })
})

describe('klinger', () => {
  const withRange = (i: number, close: number): Candle => ({
    time: 1_700_000_000 + i * 3600,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 10 + i,
  })

  test('emits from the slow-EMA window with finite values', () => {
    const series = Array.from({ length: 70 }, (_, i) => withRange(i, 100 + i))
    const line = klinger(series)
    expect(line).toHaveLength(70 - 55) // first point at candle index 55
    expect(Number(line[0]!.time)).toBe(Number(series[55]!.time))
    line.forEach((p) => expect(Number.isFinite(p.value)).toBe(true))
  })

  test('too little history yields an empty line', () => {
    expect(klinger(Array.from({ length: 50 }, (_, i) => withRange(i, 100)))).toEqual([])
  })
})

describe('historicalVol', () => {
  test('flat closes read zero; varying returns read positive; emits from index period', () => {
    const flat = bars(...(Array(12).fill(100) as number[]))
    const hvFlat = historicalVol(flat, 5)
    expect(hvFlat).toHaveLength(12 - 5)
    expect(Number(hvFlat[0]!.time)).toBe(Number(flat[5]!.time))
    hvFlat.forEach((p) => expect(p.value).toBeCloseTo(0, 10))
    const varying = bars(...Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 100 : 105)))
    expect(historicalVol(varying, 5).at(-1)!.value).toBeGreaterThan(0)
  })

  test('too little history yields an empty line', () => {
    expect(historicalVol(bars(100, 100, 100), 5)).toEqual([])
  })
})

describe('kst', () => {
  test('positive in a rising series; emits once the longest ROC+SMA window exists', () => {
    const rising = bars(...Array.from({ length: 60 }, (_, i) => 100 + i))
    const line = kst(rising)
    // Longest window = ROC30 + SMA15 → first point at index 44.
    expect(line).toHaveLength(60 - 44)
    expect(Number(line[0]!.time)).toBe(Number(rising[44]!.time))
    expect(line.at(-1)!.value).toBeGreaterThan(0)
  })

  test('too little history yields an empty line', () => {
    expect(kst(bars(...Array.from({ length: 40 }, (_, i) => 100 + i)))).toEqual([])
  })
})

describe('coppock', () => {
  test('positive and defined once the ROC(14)+WMA(10) windows exist', () => {
    const rising = bars(...Array.from({ length: 30 }, (_, i) => 100 + i))
    const line = coppock(rising)
    // rocSum starts at index 14 (length 16); WMA(10) → length 7; first point at index 23.
    expect(line).toHaveLength(30 - 14 - 9)
    expect(Number(line[0]!.time)).toBe(Number(rising[23]!.time))
    expect(line.at(-1)!.value).toBeGreaterThan(0) // steadily rising → positive momentum
  })

  test('too little history (≤ the ROC lookback) yields an empty line', () => {
    expect(coppock(bars(...Array.from({ length: 14 }, (_, i) => 100 + i)))).toEqual([])
  })
})

describe('fisher', () => {
  test('turns positive in a rising series, negative in a falling one; emits from index period−1', () => {
    const rising = bars(...Array.from({ length: 20 }, (_, i) => 100 + i))
    const line = fisher(rising, 9)
    expect(line).toHaveLength(20 - 8) // first point at index 8
    expect(Number(line[0]!.time)).toBe(Number(rising[8]!.time))
    expect(line.at(-1)!.value).toBeGreaterThan(0) // median pinned to the top of its range
    const falling = bars(...Array.from({ length: 20 }, (_, i) => 120 - i))
    expect(fisher(falling, 9).at(-1)!.value).toBeLessThan(0)
  })

  test('too little history yields an empty line', () => {
    expect(fisher(bars(1, 2), 9)).toEqual([])
  })
})

describe('dpo', () => {
  test('a perfect trend detrends to a constant residual (the displaced-SMA offset)', () => {
    const series = bars(...Array.from({ length: 12 }, (_, i) => 100 + i)) // linear +1/bar
    const line = dpo(series, 4)
    // shift = ⌊4/2⌋+1 = 3; first point at index 3. For a linear series every DPO = −1.5.
    expect(Number(line[0]!.time)).toBe(Number(series[3]!.time))
    for (const p of line) expect(p.value).toBeCloseTo(-1.5, 10)
  })

  test('too little history yields an empty line', () => {
    expect(dpo(bars(1, 2, 3), 20)).toEqual([])
  })
})

describe('forceIndex', () => {
  test('seeds the EMA over bars 1..period; first point lands on index period', () => {
    const series = bars(...Array.from({ length: 20 }, (_, i) => 100 + i)) // volume 1 each
    const efi = forceIndex(series, 3)
    // Raw force = (Δclose=1) × (volume=1) = 1 every bar → EMA of a constant 1 is 1.
    expect(efi[0]!.value).toBeCloseTo(1, 10)
    expect(Number(efi[0]!.time)).toBe(Number(series[3]!.time))
    expect(efi.at(-1)!.value).toBeCloseTo(1, 10)
  })

  test('too little history yields an empty line', () => {
    expect(forceIndex(bars(1, 2), 13)).toEqual([])
  })
})

describe('adx', () => {
  const rising = bars(...Array.from({ length: 40 }, (_, i) => 100 + i * 2))

  test('a steady uptrend: +DI dominates −DI and ADX is strong', () => {
    const { adx: line, plusDi, minusDi } = adx(rising, 14)
    expect(plusDi.length).toBeGreaterThan(0)
    for (let i = 0; i < plusDi.length; i++) {
      expect(plusDi[i]!.value).toBeGreaterThan(minusDi[i]!.value)
    }
    expect(line[line.length - 1]!.value).toBeGreaterThan(25)
  })

  test('honesty: DI lines start at index `period`, ADX at `2·period − 1`', () => {
    const { adx: line, plusDi } = adx(rising, 14)
    expect(Number(plusDi[0]!.time)).toBe(Number(rising[14]!.time))
    expect(Number(line[0]!.time)).toBe(Number(rising[27]!.time))
  })

  test('too little history yields empty arrays', () => {
    expect(adx(bars(1, 2, 3), 14)).toEqual({ adx: [], plusDi: [], minusDi: [] })
  })
})

describe('the indicator catalog', () => {
  test('ids are unique and every declared series key is produced by compute()', () => {
    const ids = INDICATORS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Hourly spacing so the series spans multiple UTC days — session indicators (pivots, VWAP)
    // that need a prior day still produce points here.
    const series = Array.from({ length: 60 }, (_, i) => bar(i * 3600, 100 + Math.sin(i / 3) * 10))
    for (const spec of INDICATORS) {
      const data = spec.compute(series)
      for (const s of spec.series) {
        expect(Array.isArray(data[s.key])).toBe(true)
        expect(data[s.key]!.length).toBeGreaterThan(0)
      }
    }
  })

  test('compute is total on an empty history (a fresh chart must not throw)', () => {
    for (const spec of INDICATORS) {
      const data = spec.compute([])
      for (const s of spec.series) expect(data[s.key] ?? []).toEqual([])
    }
  })
})

describe('the chart wires the indicator engine from this catalog (source lint)', () => {
  const canvas = readCode(new URL('../ui/ChartCanvas.tsx', import.meta.url))
  const indicatorHooks = readCode(new URL('../ui/useChartIndicators.ts', import.meta.url))
  const dataFeed = readCode(new URL('../ui/useChartDataFeed.ts', import.meta.url))
  const seriesAdapter = readCode(new URL('../ui/chartIndicatorSeries.ts', import.meta.url))

  test('the selection persists and toggles through the v2 prefs, keyed per tab', () => {
    // The save carries the tab key (the runtime's controlKey) — a keyless write would silently
    // demote every chart back to one global indicator set.
    mustFind(indicatorHooks, /saveIndicatorPrefsV2\(\s*\{/)
    mustFind(
      indicatorHooks,
      /rt\.props\.current\.controlKey,\s*\)\s*\n\s*\}, \[rt, items, scaleMode\]\)/,
    )
    mustFind(indicatorHooks, /loadIndicatorPrefsV2\(controlKey\)/)
    mustFind(canvas, /toggleIndicatorV2\(prev, id\)/)
  })

  test('the series are (re)built from the RESOLVED active specs after the old ones are torn down', () => {
    const cleared = mustFind(seriesAdapter, /seriesById\.clear\(\)/)
    expect(mustFind(seriesAdapter, /for \(const spec of specs\)/)).toBeGreaterThan(cleared)
    mustFind(indicatorHooks, /rebuildIndicatorSeries\(\{\s*chart,\s*specs: activeSpecs,/)
    // The resolution itself must be the parameterized one (any `ema:200`, not just the presets).
    mustFind(indicatorHooks, /resolveIndicators\(active\)/)
  })

  /**
   * THE LOOP THIS LINT USED TO MISS.
   *
   * `for (const spec of INDICATORS)` appeared TWICE in ChartCanvas — once to REBUILD the series when
   * the selection changes, once to FEED them on every data push. A whole-file `toContain` for that
   * token is therefore satisfied by the rebuild loop, and says nothing about the feed loop. Verified:
   * commenting the feed loop out left this file at 15 pass / 0 fail, with the chart no longer
   * updating a single indicator on a streaming tick — the exact defect the lint was written to
   * prevent, reported green.
   *
   * A token that occurs twice does not identify a subject. So LOCATE the subject — the gated feed
   * block — and require the loop to be inside IT. `namedBody` throws if the block is gone; `mustFind`
   * throws if the loop is not in it. Neither can pass by looking at the other loop.
   */
  test('every enabled indicator is FED on a data push, and only while some are enabled', () => {
    const feed = namedBody(
      dataFeed,
      /if \(change\.kind !== 'none' && rt\.activeSpecs\.current\.length > 0\)/,
      'the gated per-tick indicator feed',
    )
    mustFind(feed, /for \(const spec of rt\.activeSpecs\.current\)/)
    mustFind(feed, /feedIndicator\(spec, owned, candles,/)
  })
})
