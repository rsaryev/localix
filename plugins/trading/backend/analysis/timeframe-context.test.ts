import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { higherTimeframe, renderTimeframeContext, timeframeContext } from './timeframe-context'

const bar = (i: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  close,
  high: close + 1,
  low: close - 1,
  volume: 10,
})

describe('higherTimeframe', () => {
  it('steps up conventional tokens, is case-insensitive, and tops out', () => {
    expect(higherTimeframe('5m')).toBe('1h')
    expect(higherTimeframe('1h')).toBe('4h')
    expect(higherTimeframe('4h')).toBe('1d')
    expect(higherTimeframe('1H')).toBe('4h')
    expect(higherTimeframe('1w')).toBeNull()
    expect(higherTimeframe('nonsense')).toBeNull()
  })
})

describe('timeframeContext + render', () => {
  const up = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i))
  const down = Array.from({ length: 40 }, (_, i) => bar(i, 200 - i))

  it('reads regime and trend for the higher timeframe', () => {
    const ctx = timeframeContext(up, '4h')
    expect(ctx.timeframe).toBe('4h')
    expect(ctx.trend).toBe('up')
    expect(ctx.regime).toBe('trending')
  })

  it('flags alignment when the higher trend agrees with the primary', () => {
    const text = renderTimeframeContext(timeframeContext(up, '4h'), 'up').join('\n')
    expect(text).toContain('higher timeframe (4h)')
    expect(text).toContain('ALIGNED')
  })

  it('flags a counter-trend higher timeframe against the primary', () => {
    const text = renderTimeframeContext(timeframeContext(down, '4h'), 'up').join('\n')
    expect(text).toContain('AGAINST')
  })

  it('omits alignment when either side is flat, and renders nothing when the read is empty', () => {
    const flatText = renderTimeframeContext(timeframeContext(up, '4h'), 'flat').join('\n')
    expect(flatText).not.toContain('ALIGNED')
    expect(flatText).not.toContain('AGAINST')
    expect(renderTimeframeContext({ timeframe: '4h', regime: null, trend: null }, 'up')).toEqual([])
  })
})
