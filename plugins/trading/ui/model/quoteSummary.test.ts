import { describe, expect, test } from 'bun:test'
import type { Candle, Ticker } from '../../backend/contracts'
import { baseVolumeUnitLabel, formatSpan, rangePosition, summarizeMarket } from './quoteSummary'
import type { SizeUnitMarket } from '../../backend/size-unit'
import { readCode } from '@localixai/source-lint'

const bar = (
  time: number,
  open: number,
  close: number,
  high = Math.max(open, close),
  low = Math.min(open, close),
  volume = 1,
): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
})

const HOUR = 3600

describe('summarizeMarket', () => {
  test('uses ticker fields when present', () => {
    const ticker: Ticker = {
      symbol: 'X',
      timestamp: 1700000000000,
      last: 100,
      high: 110,
      low: 90,
      change: 0.05,
      baseVolume: 5,
      quoteVolume: 500,
    }
    const s = summarizeMarket(ticker, [bar(1, 90, 100)])
    expect(s).toEqual({
      last: 100,
      high: 110,
      low: 90,
      change: 0.05,
      baseVolume: 5,
      quoteVolume: 500,
      timestamp: 1700000000000,
      // Nothing was derived, so the candles measured nothing: the figures are the venue's own 24h stats.
      windowSeconds: null,
      highLowFromCandles: false,
      changeFromCandles: false,
      baseVolumeFromCandles: false,
      // The absolute change is backed out of the venue's OWN percentage, so the two agree.
      previousPrice: 100 / 1.05,
      changeAbs: 100 - 100 / 1.05,
    })
  })

  test('candles with no reported volume derive NO volume — not a stated zero', () => {
    // Summing an unreported volume as 0 turns a window of silent bars into `vol 0`, which reads as
    // a market nobody trades rather than as a market whose volume the venue does not publish.
    const ticker: Ticker = { symbol: 'X', timestamp: 0, last: 105 }
    const noVolume: Candle[] = [
      { time: 0, open: 100, high: 103, low: 99, close: 102 },
      { time: HOUR, open: 102, high: 108, low: 101, close: 105 },
    ]
    const s = summarizeMarket(ticker, noVolume)
    expect(s.baseVolume).toBeNull()
    expect(s.baseVolumeFromCandles).toBe(false)
  })

  test('a window mixing reported and unreported volumes sums only what was reported', () => {
    const ticker: Ticker = { symbol: 'X', timestamp: 0, last: 105 }
    const mixed: Candle[] = [
      { time: 0, open: 100, high: 103, low: 99, close: 102 },
      bar(HOUR, 102, 105, 108, 101, 3),
    ]
    expect(summarizeMarket(ticker, mixed).baseVolume).toBe(3)
  })

  test('derives high/low/change/volume from candles when the ticker is thin', () => {
    // Thin Hyperliquid-style ticker: last + quoteVolume only, timestamp 0.
    const ticker: Ticker = { symbol: 'X', timestamp: 0, last: 105, quoteVolume: 999 }
    const candles = [bar(0, 100, 102, 103, 99, 2), bar(HOUR, 102, 105, 108, 101, 3)]
    const s = summarizeMarket(ticker, candles)
    expect(s.last).toBe(105)
    expect(s.high).toBe(108)
    expect(s.low).toBe(99)
    expect(s.change).toBeCloseTo((105 - 100) / 100, 6) // vs first bar open in window
    expect(s.baseVolume).toBe(5)
    expect(s.quoteVolume).toBe(999)
    expect(s.timestamp).toBeNull() // a 0 timestamp is "unknown", never a date
  })

  test('restricts the derived window to the trailing 24h', () => {
    const now = 100 * HOUR
    const stale = bar(now - 30 * HOUR, 10, 10, 999, 1, 100) // outside 24h — ignored
    const recent = bar(now, 100, 105, 106, 95, 2)
    const s = summarizeMarket({ symbol: 'X', timestamp: 0, last: 105 }, [stale, recent])
    expect(s.high).toBe(106) // not 999
    expect(s.low).toBe(95) // not 1
    expect(s.baseVolume).toBe(2)
  })

  test('empty everything → nulls, no NaN', () => {
    const s = summarizeMarket(null, [])
    expect(s).toEqual({
      last: null,
      high: null,
      low: null,
      change: null,
      baseVolume: null,
      quoteVolume: null,
      timestamp: null,
      windowSeconds: null,
      highLowFromCandles: false,
      changeFromCandles: false,
      baseVolumeFromCandles: false,
      previousPrice: null,
      changeAbs: null,
    })
  })
})

describe('a derived figure is not a 24h figure', () => {
  // 500 one-minute bars span eight hours. Labelling their high `24h High` claims a day of market
  // the chart never loaded.
  const minuteBars = (n: number): Candle[] =>
    Array.from({ length: n }, (_, i) => ({
      time: i * 60,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 1,
    }))

  test('a thin ticker reports the window the candles actually measure', () => {
    const s = summarizeMarket({ symbol: 'X', last: 10, timestamp: 0 } as Ticker, minuteBars(500))
    expect(s.highLowFromCandles).toBe(true)
    expect(s.windowSeconds).toBe(499 * 60)
    expect(formatSpan(s.windowSeconds!)).toBe('8h')
  })

  test('a venue-reported high measures nothing of ours', () => {
    const s = summarizeMarket(
      {
        symbol: 'X',
        last: 10,
        high: 12,
        low: 8,
        change: 0.01,
        baseVolume: 5,
        timestamp: 1,
      } as Ticker,
      minuteBars(500),
    )
    expect(s.highLowFromCandles).toBe(false)
    expect(s.changeFromCandles).toBe(false)
    expect(s.baseVolumeFromCandles).toBe(false)
    expect(s.windowSeconds).toBeNull()
  })

  test('a single bar measures no span at all', () => {
    expect(summarizeMarket(null, minuteBars(1)).windowSeconds).toBeNull()
  })

  test('formatSpan rounds down — it never overstates the window', () => {
    expect(formatSpan(59)).toBe('59s')
    expect(formatSpan(60)).toBe('1m')
    expect(formatSpan(3599)).toBe('59m')
    expect(formatSpan(86_399)).toBe('23h')
    expect(formatSpan(86_400)).toBe('1d')
  })
})

describe('a venue-reported 24h change is not derived', () => {
  test("Hyperliquid's prevDayPx-derived change labels itself 24h, not the candle window", () => {
    // `normalizeTicker` fills `change` from `previousClose`, so the header must not fall back to
    // measuring 500 one-minute bars and calling the result a day.
    const bars: Candle[] = Array.from({ length: 500 }, (_, i) => ({
      time: i * 60,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 1,
    }))
    const s = summarizeMarket(
      { symbol: 'X', last: 10, change: 0.0163, timestamp: 0 } as Ticker,
      bars,
    )
    expect(s.change).toBe(0.0163)
    expect(s.changeFromCandles).toBe(false)
    // High/low are still ours to measure, and still labelled by the window we measured.
    expect(s.highLowFromCandles).toBe(true)
  })
})

describe('a percentage alone hides how much money moved', () => {
  // The reference UI prints `+26.7 / +0.36%`. On a 7,527 index the points are what a trader sizes a
  // stop against; the percentage alone does not say it.
  const bars: Candle[] = [
    { time: 0, open: 7500, high: 7530, low: 7490, close: 7500, volume: 1 },
    { time: 3600, open: 7500, high: 7530, low: 7490, close: 7527.7, volume: 1 },
  ]

  test("the venue's previousClose is the reference when it reports one", () => {
    const s = summarizeMarket(
      { symbol: 'X', last: 7527.7, previousClose: 7501, timestamp: 0 } as Ticker,
      bars,
    )
    expect(s.previousPrice).toBe(7501)
    expect(s.changeAbs).toBeCloseTo(26.7, 6)
  })

  test('otherwise it is backed out of the venue percentage, so the two agree', () => {
    const s = summarizeMarket(
      { symbol: 'X', last: 105, change: 0.05, timestamp: 0 } as Ticker,
      bars,
    )
    expect(s.previousPrice).toBeCloseTo(100, 9)
    expect(s.changeAbs).toBeCloseTo(5, 9)
    // Consistency: abs / previous === the percentage the header prints beside it.
    expect(s.changeAbs! / s.previousPrice!).toBeCloseTo(s.change!, 9)
  })

  test('a candle-derived change measures from the window opening bar', () => {
    const s = summarizeMarket(null, bars)
    expect(s.previousPrice).toBe(7500)
    expect(s.changeAbs).toBeCloseTo(27.7, 6)
  })

  test('no reference price means no absolute change is stated', () => {
    expect(
      summarizeMarket({ symbol: 'X', last: 100, timestamp: 0 } as Ticker, []).changeAbs,
    ).toBeNull()
  })
})

describe('baseVolumeUnitLabel — one field, two sources, two units', () => {
  const hl: SizeUnitMarket = { base: 'BTC', contract: true, contractSize: 1, linear: true }
  /** OKX `BTC-USDT-SWAP`: `ctVal` 0.01. Its ticker counts contracts; its candles count BTC. */
  const okx: SizeUnitMarket = { base: 'BTC', contract: true, contractSize: 0.01, linear: true }

  const tickerVol = (baseVolume: number): Ticker => ({ symbol: 'BTC/USDT:USDT', baseVolume })

  test("a VENUE-reported figure is the venue's own count — contracts on a contract market", () => {
    // ccxt hands back OKX's `vol24h` unconverted. Calling it BTC overstates the tape 100x.
    const s = summarizeMarket(tickerVol(1000), [bar(1, 90, 100)])
    expect(s.baseVolumeFromCandles).toBe(false)
    expect(baseVolumeUnitLabel(s, okx)).toBe('cont')
  })

  test('a CANDLE-derived figure counts the asset — ccxt normalizes OHLCV volume to base', () => {
    // The same market, no ticker volume: OKX's `parseOHLCV` picks the base-volume index for non-spot.
    const s = summarizeMarket(null, [bar(1, 90, 100), bar(2, 100, 101)])
    expect(s.baseVolumeFromCandles).toBe(true)
    expect(baseVolumeUnitLabel(s, okx)).toBe('BTC')
  })

  test('the two agree where a contract IS one base unit (Hyperliquid)', () => {
    const fromTicker = summarizeMarket(tickerVol(1000), [bar(1, 90, 100)])
    const fromCandles = summarizeMarket(null, [bar(1, 90, 100)])
    expect(baseVolumeUnitLabel(fromTicker, hl)).toBe('BTC')
    expect(baseVolumeUnitLabel(fromCandles, hl)).toBe('BTC')
  })

  test('an unknown market names no unit rather than the wrong one', () => {
    expect(baseVolumeUnitLabel(summarizeMarket(tickerVol(1000), []), null)).toBe('')
    expect(baseVolumeUnitLabel(summarizeMarket(null, [bar(1, 90, 100)]), null)).toBe('')
  })

  test('no volume at all names nothing', () => {
    const s = summarizeMarket(null, [{ time: 1, open: 90, high: 100, low: 90, close: 100 }])
    expect(s.baseVolume).toBeNull()
    expect(baseVolumeUnitLabel(s, okx)).toBe('')
  })
})

describe('rangePosition', () => {
  test('fraction from low to high', () => {
    expect(rangePosition(50, 100, 0)).toBeCloseTo(0.5, 10)
    expect(rangePosition(90, 100, 0)).toBeCloseTo(0.9, 10)
    expect(rangePosition(0, 100, 0)).toBe(0)
    expect(rangePosition(100, 100, 0)).toBe(1)
  })

  test('a fresh extreme past the window bound is clamped into [0, 1]', () => {
    // `last` just printed a new high above the derived window high — reads as the top, not 1.2.
    expect(rangePosition(120, 100, 0)).toBe(1)
    expect(rangePosition(-5, 100, 0)).toBe(0)
  })

  test('null when a bound is missing or the range has no width — never a fabricated 0.5', () => {
    expect(rangePosition(null, 100, 0)).toBeNull()
    expect(rangePosition(50, null, 0)).toBeNull()
    expect(rangePosition(50, 100, null)).toBeNull()
    expect(rangePosition(50, 100, 100)).toBeNull()
  })
})

describe('the chart header renders the range-position indicator (source lint)', () => {
  const header = readCode(new URL('../ui/ChartHeader.tsx', import.meta.url))
  test('it reads rangePosition and falls back to plain stats on null, never a fabricated 50%', () => {
    expect(header).toContain('rangePosition(summary.last, summary.high, summary.low)')
    // No usable position (or a missing bound) → the plain high/low stats, never a marker with a
    // fabricated centre.
    expect(header).toContain('pos === null || summary.high == null || summary.low == null')
  })
  test('the low and high prices read as one low–high line — the range is self-describing', () => {
    // A clean two-line label/value column (matching the other Stat cells): the endpoints read as
    // "low – high" on one line, and the last price's position within the range lives in the tooltip.
    expect(header).toContain('{price(summary.low)}')
    expect(header).toContain('{price(summary.high)}')
    expect(header).toContain('% of the way from the ${rangeLabel} low to the high')
  })
})
