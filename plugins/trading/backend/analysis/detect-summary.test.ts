import { describe, expect, it } from 'bun:test'
import { renderDetectSummary } from './detect-summary'
import type { CompositeSignal } from './composite-signal'
import type { MarketRegime, TrendFit } from './pattern-detect'
import type { TimeframeContext } from './timeframe-context'

const regime = (kind: MarketRegime['kind']): MarketRegime => ({ kind, confidence: 0.8, note: '' })

const trend = (direction: TrendFit['direction']): TrendFit => ({
  direction,
  pctPerBar: 0.001,
  r2: 0.9,
  start: { time: 0, price: 100 },
  end: { time: 1, price: 101 },
})

const signal = (bias: CompositeSignal['bias'], conviction: number): CompositeSignal => ({
  bias,
  conviction,
  dimensions: [],
})

const htf = (tf: string, t: TimeframeContext['trend']): TimeframeContext => ({
  timeframe: tf,
  regime: 'trending',
  trend: t,
})

describe('renderDetectSummary', () => {
  it('names regime+trend, composite bias with conviction, and HTF alignment', () => {
    const line = renderDetectSummary({
      regime: regime('trending'),
      trend: trend('up'),
      signal: signal('long', 0.67),
      htf: htf('4h', 'up'),
    })
    expect(line).toBe('Summary: trending up · composite long 67% · 4h up aligned')
  })

  it('marks a counter higher timeframe as against', () => {
    const line = renderDetectSummary({
      regime: regime('ranging'),
      trend: trend('down'),
      signal: signal('short', 0.5),
      htf: htf('1d', 'up'),
    })
    expect(line).toContain('1d up against')
  })

  it('omits alignment when either side is flat', () => {
    const line = renderDetectSummary({
      regime: regime('ranging'),
      trend: trend('flat'),
      signal: null,
      htf: htf('4h', 'up'),
    })
    expect(line).toContain('4h up')
    expect(line).not.toContain('aligned')
    expect(line).not.toContain('against')
  })

  it('names a structure break after the regime, then value-area location, then the AT-confluence decision point', () => {
    const line = renderDetectSummary({
      regime: regime('trending'),
      trend: trend('up'),
      signal: signal('long', 0.6),
      htf: null,
      structureBreak: { type: 'BOS', direction: 'bullish', level: 100, brokenAt: 2, swingTime: 1 },
      atConfluence: true,
      valueArea: 'discount',
    })
    expect(line).toBe(
      'Summary: trending up · BOS ↑ · composite long 60% · discount · AT confluence',
    )
  })

  it('omits a fair value-area (only premium/discount earn a segment)', () => {
    const line = renderDetectSummary({
      regime: regime('ranging'),
      trend: null,
      signal: null,
      htf: null,
      valueArea: 'fair',
    })
    expect(line).toBe('Summary: ranging')
  })

  it('omits the structure and confluence segments when absent', () => {
    const line = renderDetectSummary({
      regime: regime('ranging'),
      trend: null,
      signal: null,
      htf: null,
      structureBreak: null,
      atConfluence: false,
    })
    expect(line).toBe('Summary: ranging')
  })

  it('returns null when there is nothing to summarise', () => {
    expect(renderDetectSummary({ regime: null, trend: null, signal: null, htf: null })).toBeNull()
  })
})
