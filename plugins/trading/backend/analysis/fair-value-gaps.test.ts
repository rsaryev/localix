import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { detectFairValueGaps, fvgDrawPayloads, renderFairValueGaps } from './fair-value-gaps'

const bar = (time: number, high: number, low: number, close: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 10,
})

describe('detectFairValueGaps', () => {
  it('detects a bullish gap: candle a.high below candle c.low', () => {
    // a.high 100, b jumps, c.low 105 → gap band 100–105. Price stays above → unfilled.
    const gaps = detectFairValueGaps([
      bar(0, 100, 95, 99),
      bar(60, 110, 104, 108),
      bar(120, 112, 105, 110),
      bar(180, 113, 108, 111),
    ])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]!.direction).toBe('bullish')
    expect(gaps[0]!.bottom).toBeCloseTo(100, 5)
    expect(gaps[0]!.top).toBeCloseTo(105, 5)
    expect(gaps[0]!.mid).toBeCloseTo(102.5, 5)
  })

  it('detects a bearish gap: candle a.low above candle c.high', () => {
    // a.low 100, drop, c.high 95 → gap band 95–100. Price stays below → unfilled.
    const gaps = detectFairValueGaps([
      bar(0, 105, 100, 101),
      bar(60, 98, 90, 92),
      bar(120, 95, 88, 90),
      bar(180, 94, 87, 89),
    ])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]!.direction).toBe('bearish')
    expect(gaps[0]!.bottom).toBeCloseTo(95, 5)
    expect(gaps[0]!.top).toBeCloseTo(100, 5)
  })

  it('drops a gap that a later candle fully trades back through', () => {
    // Bullish gap 100–105, then a candle dips to 99 (below the floor) → filled, excluded.
    const gaps = detectFairValueGaps([
      bar(0, 100, 95, 99),
      bar(60, 110, 104, 108),
      bar(120, 112, 105, 110),
      bar(180, 108, 99, 100),
    ])
    expect(gaps).toHaveLength(0)
  })

  it('ignores overlapping (no-gap) triples', () => {
    const gaps = detectFairValueGaps([
      bar(0, 102, 98, 100),
      bar(60, 103, 99, 101),
      bar(120, 104, 100, 102),
    ])
    expect(gaps).toHaveLength(0)
  })

  it('flags distancePct 0 when price sits inside the gap', () => {
    // Bullish gap 100–105; last close 103 is inside the band.
    const gaps = detectFairValueGaps([
      bar(0, 100, 95, 99),
      bar(60, 110, 104, 108),
      bar(120, 112, 105, 103),
    ])
    expect(gaps[0]!.distancePct).toBe(0)
  })

  it('returns nothing below three candles', () => {
    expect(detectFairValueGaps([bar(0, 100, 95, 99), bar(60, 110, 104, 108)])).toHaveLength(0)
  })
})

describe('renderFairValueGaps', () => {
  it('renders a band line per gap and flags being inside one', () => {
    const gaps = detectFairValueGaps([
      bar(0, 100, 95, 99),
      bar(60, 110, 104, 108),
      bar(120, 112, 105, 103),
    ])
    const text = renderFairValueGaps(gaps).join('\n')
    expect(text).toContain('INSIDE a bullish fair value gap')
    expect(text).toContain('fair value gaps')
    expect(text).toContain('bullish')
  })

  it('renders nothing for no gaps', () => {
    expect(renderFairValueGaps([])).toHaveLength(0)
  })
})

describe('fvgDrawPayloads', () => {
  it('draws each gap as a stable-id zone band, capped', () => {
    const gaps = detectFairValueGaps([
      bar(0, 100, 95, 99),
      bar(60, 110, 104, 108),
      bar(120, 112, 105, 110),
      bar(180, 113, 108, 111),
    ])
    const payloads = fvgDrawPayloads('conn', 'BTC/USDT', gaps)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.action).toBe('draw')
    expect(payloads[0]!.drawing!.kind).toBe('zone')
    expect(payloads[0]!.drawing!.id).toBe('fvg-1')
  })

  it('caps the number of drawn zones', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      direction: 'bullish' as const,
      top: 100 + i,
      bottom: 99 + i,
      mid: 99.5 + i,
      time: i,
      distancePct: i,
    }))
    expect(fvgDrawPayloads('c', 'S', many)).toHaveLength(3)
  })
})
