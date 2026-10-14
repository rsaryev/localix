import { describe, expect, test } from 'bun:test'

import { type CandleLike, candleSummary, trendLine } from './candle-lines'

/**
 * Behavior lock for the agent-facing candle renderers. candleSummary/trendLine are what the
 * `market_data` tool and the `localix://resource/trade/` candles leaf hand the agent to reason about a window —
 * a wrong direction, percent, or high/low would mislead its trade reasoning, not just the
 * display. The numeric core (sma/maCrossBias) is tested separately; this pins the summary text.
 */
const k = (open: number, high: number, low: number, close: number, time = 0): CandleLike => ({
  time,
  open,
  high,
  low,
  close,
})

describe('candleSummary', () => {
  test('a rising window: direction ▲, signed percent, window high/low', () => {
    const s = candleSummary([k(100, 105, 98, 102), k(102, 115, 95, 110)], '1h')
    expect(s).toContain('O 100 → C 110')
    expect(s).toContain('▲')
    expect(s).toContain('+10.00%') // (110-100)/100
    expect(s).toContain('H 115 L 95') // extrema across ALL bars, not just first/last
  })

  test('a falling window: ▼ and a negative percent', () => {
    const s = candleSummary([k(100, 101, 80, 90)], '1h')
    expect(s).toContain('▼')
    expect(s).toContain('-10.00%')
  })

  test('a flat window: = and +0.00%', () => {
    const s = candleSummary([k(100, 100, 100, 100)], '1h')
    expect(s).toContain('=')
  })

  test('open === 0 omits the percent (never a fabricated 0%)', () => {
    const s = candleSummary([k(0, 5, 0, 3)], '1h')
    expect(s).toContain('▲')
    expect(s).not.toContain('%')
  })

  test('empty window → null', () => {
    expect(candleSummary([], '1h')).toBeNull()
  })
})

describe('trendLine', () => {
  const closes = (n: number, v = 100): CandleLike[] =>
    Array.from({ length: n }, (_, i) => k(v, v, v, v, i))

  test('names an unmet slow period instead of warping it, and asserts no bias', () => {
    // 20 bars: MA20 computable, MA50 not. Bias must be absent (unknown ≠ flat).
    const line = trendLine(closes(20), 105)
    expect(line).toContain('MA20 100')
    expect(line).toContain('MA50 needs ≥50 candles')
    expect(line).not.toContain('bullish')
    expect(line).not.toContain('bearish')
  })

  test('reports where price sits vs the fast average, with magnitude', () => {
    expect(trendLine(closes(20), 105)).toContain('price above MA20 by 5.00%')
    expect(trendLine(closes(20), 95)).toContain('price below MA20 by 5.00%')
  })

  test('null when neither average can be computed (window too short)', () => {
    expect(trendLine(closes(1), 100)).toBeNull()
  })
})
