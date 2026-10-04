import { describe, expect, it } from 'bun:test'
import type { Candle } from './contracts'
import { computeIndicatorReadings, indicatorLines, indicatorReading } from './indicator-values'
import { ema as uiEma, rsi as uiRsi } from '../ui/model/indicators'

/** A bar an hour apart; open = previous close so the series is a continuous walk. */
function bars(closes: number[], volume?: (i: number) => number | undefined): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!
    return {
      time: 1_700_000_000 + i * 3600,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      ...(volume ? { volume: volume(i) } : { volume: 100 + i }),
    }
  })
}

/** 60 deterministic bars — long enough for every default lookback except ema:200. */
const FIXTURE = bars(Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.4))

describe('indicatorReading — golden values', () => {
  it('sma is the trailing mean of the closes', () => {
    const c = bars([10, 20, 30, 40, 50])
    expect(indicatorReading('sma:3', c)!.plots).toEqual({ line: 40 }) // (30+40+50)/3
  })

  it('ema seeds with the SMA and smooths with k = 2/(n+1)', () => {
    const c = bars([10, 20, 30, 40])
    // seed (10+20+30)/3 = 20; k = 0.5; next = 40·0.5 + 20·0.5 = 30
    expect(indicatorReading('ema:3', c)!.plots).toEqual({ line: 30 })
  })

  it('rsi over an all-up window reads 100 — by construction', () => {
    const c = bars(Array.from({ length: 20 }, (_, i) => 100 + i))
    expect(indicatorReading('rsi:14', c)!.plots).toEqual({ line: 100 })
  })

  it('vwap is Σ(typical·vol)/Σ(vol) within the UTC day', () => {
    // Two bars in one UTC day, volumes 10 and 30.
    const c: Candle[] = [
      { time: 1_700_000_000, open: 10, high: 12, low: 8, close: 10, volume: 10 },
      { time: 1_700_003_600, open: 10, high: 22, low: 14, close: 18, volume: 30 },
    ]
    const typical1 = (12 + 8 + 10) / 3
    const typical2 = (22 + 14 + 18) / 3
    const expected = (typical1 * 10 + typical2 * 30) / 40
    expect(indicatorReading('vwap', c)!.plots.line).toBeCloseTo(expected, 10)
  })

  it("volume (built into the chart) reads the newest bar's own volume", () => {
    expect(indicatorReading('volume', FIXTURE)!.plots).toEqual({ volume: 100 + 59 })
    const noVol = bars([1, 2, 3], () => undefined)
    expect(indicatorReading('volume', noVol)!.plots).toEqual({})
  })

  it('multi-plot kinds report every plot the chart legend shows', () => {
    expect(Object.keys(indicatorReading('bb:20:2', FIXTURE)!.plots).sort()).toEqual([
      'basis',
      'lower',
      'upper',
    ])
    expect(Object.keys(indicatorReading('macd', FIXTURE)!.plots).sort()).toEqual([
      'histogram',
      'macd',
      'signal',
    ])
    expect(Object.keys(indicatorReading('stoch:14:3:3', FIXTURE)!.plots).sort()).toEqual(['d', 'k'])
    expect(Object.keys(indicatorReading('adx:14', FIXTURE)!.plots).sort()).toEqual([
      'adx',
      'minusDi',
      'plusDi',
    ])
    expect(Object.keys(indicatorReading('supertrend:10:3', FIXTURE)!.plots)).toEqual(['line'])
    expect(Object.keys(indicatorReading('atr:14', FIXTURE)!.plots)).toEqual(['line'])
    expect(Object.keys(indicatorReading('obv', FIXTURE)!.plots)).toEqual(['line'])
  })

  it('MATCHES the UI legend math exactly — one computation, two surfaces', () => {
    // The module calls the chart's own compute; these pin the seam so an extraction or
    // refactor that forks the math fails loudly.
    expect(indicatorReading('ema:20', FIXTURE)!.plots.line).toBe(uiEma(FIXTURE, 20).at(-1)!.value)
    expect(indicatorReading('rsi:14', FIXTURE)!.plots.line).toBe(uiRsi(FIXTURE, 14).at(-1)!.value)
  })

  it('an unmet lookback window yields NO plot — never a warped partial', () => {
    expect(indicatorReading('ema:200', FIXTURE)!.plots).toEqual({})
    expect(indicatorReading('rsi:14', bars([1, 2, 3]))!.plots).toEqual({})
  })

  it('an unparseable spelling is null', () => {
    expect(indicatorReading('nonsense:9', FIXTURE)).toBeNull()
    expect(indicatorReading('vwap:20', FIXTURE)).toBeNull() // parameterless kind rejects params
  })
})

describe('computeIndicatorReadings', () => {
  it('dedupes by canonical id and keeps request order', () => {
    const { readings, unknown } = computeIndicatorReadings(
      ['EMA 20', 'ema:20', 'rsi14', 'bogus'],
      FIXTURE,
    )
    expect(readings.map((r) => r.id)).toEqual(['ema:20', 'rsi:14'])
    expect(unknown).toEqual(['bogus'])
  })
})

describe('indicatorLines — the market_data block', () => {
  it('names the window, the label, the canonical id and the value', () => {
    const lines = indicatorLines(['rsi:14'], FIXTURE, '1h')
    expect(lines[0]).toContain('60×1h')
    expect(lines[1]).toMatch(/- RSI 14 \(rsi:14\) = \d/)
  })

  it('a multi-plot indicator names each plot', () => {
    const lines = indicatorLines(['macd'], FIXTURE, '1h')
    expect(lines[1]).toContain('MACD (12, 26, 9) (macd:12:26:9): ')
    // Plots come in the chart spec's own series order (histogram drawn first, under the lines).
    expect(lines[1]).toMatch(/histogram=-?[\d.]+, macd=-?[\d.]+, signal=-?[\d.]+/)
  })

  it('an unmet window says so instead of printing a number', () => {
    const lines = indicatorLines(['ema:200'], FIXTURE, '1h')
    expect(lines[1]).toContain('insufficient bars')
    expect(lines[1]).not.toMatch(/= \d/)
  })

  it('unknown spellings get a fix-it naming the accepted forms', () => {
    const lines = indicatorLines(['bogus'], FIXTURE, '1h')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('unknown indicator spec')
    expect(lines[0]).toContain('ema:<period>')
  })
})
