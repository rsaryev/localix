import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import {
  candleFlags,
  classifyRegime,
  detectLevels,
  detectPatterns,
  trendFit,
} from './pattern-detect'
import { detectDrawPayloads, renderPatternReport } from './detect-report'
import { parseChartCommandPayload } from '../chart-command'

const bar = (i: number, over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...over,
})

/** A range-bound series that taps ~110 (resistance) and ~90 (support) twice each at
 *  INTERIOR pivots (a pivot needs ±span bars around it, so the edges never count). */
function rangeBound(): Candle[] {
  const cycle = [100, 104, 108, 104, 100, 96, 92, 96]
  const closes = [...cycle, ...cycle, ...cycle, 100]
  return closes.map((close, i) =>
    bar(i, {
      open: close,
      close,
      high: close === 108 ? 110 : close + 1,
      low: close === 92 ? 90 : close - 1,
    }),
  )
}

describe('detectLevels — pivot clustering', () => {
  it('finds the repeated extremes with their touch counts, classified against the last close', () => {
    const levels = detectLevels(rangeBound())
    const support = levels.find((l) => l.kind === 'support')
    const resistance = levels.find((l) => l.kind === 'resistance')
    expect(support).toBeDefined()
    expect(resistance).toBeDefined()
    expect(support!.price).toBeCloseTo(90, 5)
    expect(support!.touches).toBe(2)
    expect(resistance!.price).toBeCloseTo(110, 5)
    expect(resistance!.touches).toBe(2)
  })

  it('too short a window yields nothing rather than fake pivots', () => {
    expect(detectLevels([bar(0), bar(1), bar(2)])).toEqual([])
  })

  it('caps the levels per side, strongest first', () => {
    // Many distinct one-touch pivots: alternate spikes at distinct prices.
    const candles = Array.from({ length: 60 }, (_, i) =>
      bar(i, {
        high: i % 8 === 4 ? 120 + i : 101,
        low: i % 8 === 0 ? 80 - (i % 16) : 99,
      }),
    )
    const levels = detectLevels(candles, { maxPerSide: 2 })
    expect(levels.filter((l) => l.kind === 'support').length).toBeLessThanOrEqual(2)
    expect(levels.filter((l) => l.kind === 'resistance').length).toBeLessThanOrEqual(2)
  })
})

describe('trendFit — least squares over the closes', () => {
  it('a clean ramp reads up with a strong r² and drawable endpoints', () => {
    const candles = Array.from({ length: 30 }, (_, i) => bar(i, { close: 100 + i }))
    const t = trendFit(candles)!
    expect(t.direction).toBe('up')
    expect(t.r2).toBeCloseTo(1, 5)
    expect(t.start.price).toBeCloseTo(100, 5)
    expect(t.end.price).toBeCloseTo(129, 5)
    expect(t.start.time).toBe(candles[0]!.time)
    expect(t.end.time).toBe(candles.at(-1)!.time)
  })

  it('a flat series reads flat; under 3 bars there is no fit', () => {
    expect(trendFit(Array.from({ length: 10 }, (_, i) => bar(i)))!.direction).toBe('flat')
    expect(trendFit([bar(0), bar(1)])).toBeNull()
  })
})

describe('candleFlags — single/two-bar shapes on the newest bars', () => {
  it('doji: a body that is a sliver of the range', () => {
    const flags = candleFlags([bar(0, { open: 100, close: 100.1, high: 105, low: 95 })])
    expect(flags.map((f) => f.pattern)).toEqual(['doji'])
  })

  it('hammer: long lower wick, body in the top third (mirrored: shooting star)', () => {
    expect(
      candleFlags([bar(0, { open: 103, close: 105, high: 105, low: 95 })]).map((f) => f.pattern),
    ).toEqual(['hammer'])
    expect(
      candleFlags([bar(0, { open: 97, close: 95, high: 105, low: 95 })]).map((f) => f.pattern),
    ).toEqual(['shooting_star'])
  })

  it('bullish engulfing: an up body strictly containing the prior down body', () => {
    const flags = candleFlags([
      bar(0, { open: 102, close: 100, high: 103, low: 99 }),
      bar(1, { open: 99.5, close: 103, high: 104, low: 99 }),
    ])
    expect(flags.map((f) => f.pattern)).toEqual(['bullish_engulfing'])
  })

  it('an empty series has no flags', () => {
    expect(candleFlags([])).toEqual([])
  })

  it('inverted hammer after a down leg; the same shape reads shooting star otherwise', () => {
    const shape = { open: 97, close: 95, high: 105, low: 95 }
    // Prior closes falling → the bullish inverted hammer.
    expect(
      candleFlags([bar(0, { close: 104 }), bar(1, { close: 101 }), bar(2, shape)]).map(
        (f) => f.pattern,
      ),
    ).toEqual(['inverted_hammer'])
    // Prior closes rising → the bearish shooting star.
    expect(
      candleFlags([bar(0, { close: 98 }), bar(1, { close: 101 }), bar(2, shape)]).map(
        (f) => f.pattern,
      ),
    ).toEqual(['shooting_star'])
  })

  it('spinning top: small body with real wick both sides (not a doji)', () => {
    expect(
      candleFlags([bar(0, { open: 99.4, close: 100.6, high: 103, low: 97 })]).map((f) => f.pattern),
    ).toEqual(['spinning_top'])
  })

  it('harami: a small body fully inside the prior LARGE body, colored by the prior bar', () => {
    const bull = candleFlags([
      bar(0, { open: 104, close: 98, high: 105, low: 97 }),
      bar(1, { open: 100, close: 101.4, high: 103.5, low: 98.6 }),
    ])
    expect(bull.map((f) => f.pattern)).toContain('bullish_harami')
    const bear = candleFlags([
      bar(0, { open: 98, close: 104, high: 105, low: 97 }),
      bar(1, { open: 101.4, close: 100, high: 103.5, low: 98.6 }),
    ])
    expect(bear.map((f) => f.pattern)).toContain('bearish_harami')
  })

  it('piercing line / dark cloud cover: gap open beyond the prior extreme, close past the midpoint', () => {
    expect(
      candleFlags([
        bar(0, { open: 104, close: 100, high: 105, low: 99 }),
        bar(1, { open: 98, close: 103, high: 104, low: 97.5 }),
      ]).map((f) => f.pattern),
    ).toContain('piercing_line')
    expect(
      candleFlags([
        bar(0, { open: 100, close: 104, high: 105, low: 99 }),
        bar(1, { open: 106, close: 101, high: 106.5, low: 100.5 }),
      ]).map((f) => f.pattern),
    ).toContain('dark_cloud_cover')
  })

  it('morning / evening star: body-gapped small middle bar, third bar past the first midpoint', () => {
    expect(
      candleFlags([
        bar(0, { open: 106, close: 100, high: 107, low: 99 }),
        bar(1, { open: 99.5, close: 99.2, high: 100.3, low: 97.8 }), // small body, below d1 body
        bar(2, { open: 100, close: 105, high: 106, low: 99.5 }),
      ]).map((f) => f.pattern),
    ).toContain('morning_star')
    expect(
      candleFlags([
        bar(0, { open: 100, close: 106, high: 107, low: 99 }),
        bar(1, { open: 106.5, close: 106.8, high: 108.2, low: 106.2 }), // small body above d1 body
        bar(2, { open: 106, close: 101, high: 106.5, low: 100 }),
      ]).map((f) => f.pattern),
    ).toContain('evening_star')
  })

  it('three white soldiers / three black crows: marching closes, opens inside the prior body', () => {
    expect(
      candleFlags([
        bar(0, { open: 100, close: 103, high: 103.5, low: 99.5 }),
        bar(1, { open: 101, close: 105, high: 105.5, low: 100.5 }),
        bar(2, { open: 103, close: 108, high: 108.5, low: 102.5 }),
      ]).map((f) => f.pattern),
    ).toContain('three_white_soldiers')
    expect(
      candleFlags([
        bar(0, { open: 108, close: 105, high: 108.5, low: 104.5 }),
        bar(1, { open: 107, close: 103, high: 107.5, low: 102.5 }),
        bar(2, { open: 105, close: 100, high: 105.5, low: 99.5 }),
      ]).map((f) => f.pattern),
    ).toContain('three_black_crows')
  })
})

describe('classifyRegime', () => {
  it('a clean uptrend is a trending regime', () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      bar(i, { close: 100 + i, high: 101 + i, low: 99 + i }),
    )
    const regime = classifyRegime(candles, trendFit(candles))
    expect(regime?.kind).toBe('trending')
    expect(regime!.confidence).toBeGreaterThan(0.5)
  })

  it('a range with steady volatility is a ranging regime', () => {
    const regime = classifyRegime(rangeBound(), trendFit(rangeBound()))
    expect(regime?.kind).toBe('ranging')
  })

  it('a recent volatility contraction is a compressing regime', () => {
    // Wide swings early, then a tight tail — recent ATR well below the window's typical.
    const wide = Array.from({ length: 24 }, (_, i) =>
      bar(i, { close: 100 + (i % 2 === 0 ? 8 : -8), high: 112, low: 88 }),
    )
    const tight = Array.from({ length: 12 }, (_, i) =>
      bar(24 + i, { close: 100, high: 100.4, low: 99.6 }),
    )
    const regime = classifyRegime([...wide, ...tight], trendFit([...wide, ...tight]))
    expect(regime?.kind).toBe('compressing')
  })

  it('the report renders the regime line first, in the wizard vocabulary', () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      bar(i, { close: 100 + i, high: 101 + i, low: 99 + i }),
    )
    const text = renderPatternReport(detectPatterns(candles), 'S', '1h', candles.length)
    expect(text).toContain('regime: TRENDING')
  })
})

describe('renderPatternReport + detectDrawPayloads', () => {
  it('the report carries the NUMBERS; the payloads are valid wire draw commands with stable ids', () => {
    const candles = rangeBound()
    const report = detectPatterns(candles)
    const text = renderPatternReport(report, 'BTC/USDC:USDC', '1h', candles.length)
    expect(text).toContain('BTC/USDC:USDC')
    expect(text).toContain('support @ 90')
    expect(text).toContain('resistance @ 110')
    expect(text).toContain('2 pivot touches')

    const payloads = detectDrawPayloads('c1', 'BTC/USDC:USDC', report)
    expect(payloads.length).toBeGreaterThan(0)
    for (const p of payloads) {
      expect(parseChartCommandPayload(p)).toEqual(p) // round-trips the sink guard
      expect(p.drawMode).toBe('add')
      expect(p.drawing!.id).toMatch(/^pat-/)
    }
  })

  it('a weak trend fit is reported as noise and NOT drawn', () => {
    // Alternating closes: slope ≈ 0 with terrible fit — but force a slight drift so the
    // direction is not flat, then check the r² gate.
    const candles = Array.from({ length: 40 }, (_, i) =>
      bar(i, { close: 100 + (i % 2 === 0 ? 3 : -3) + i * 0.05 }),
    )
    const report = detectPatterns(candles)
    expect(report.trend).not.toBeNull()
    expect(report.trend!.r2).toBeLessThan(0.3)
    const payloads = detectDrawPayloads('c1', 'S', report)
    expect(payloads.every((p) => p.drawing!.kind !== 'trendline')).toBe(true)
    const text = renderPatternReport(report, 'S', '1h', candles.length)
    if (report.trend!.direction !== 'flat') expect(text).toContain('WEAK fit')
  })
})
