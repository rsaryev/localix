import { describe, expect, it } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import { computeChartRead } from './chartRead'

const bar = (i: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  close,
  high: close + 1,
  low: close - 1,
  volume: 10 + i,
})

describe('computeChartRead', () => {
  it('a clean uptrend reads trending + long', () => {
    const up = Array.from({ length: 80 }, (_, i) => bar(i, 100 + i))
    const read = computeChartRead(up)
    expect(read.regime?.kind).toBe('trending')
    expect(read.signal?.bias).toBe('long')
  })

  it('too few candles yields nulls, never a fabricated read', () => {
    const read = computeChartRead([bar(0, 100), bar(1, 101), bar(2, 102)])
    expect(read.regime).toBeNull()
    expect(read.signal).toBeNull()
    expect(read.confluence).toEqual([])
    expect(read.divergence).toEqual([])
    expect(read.volatility).toBeNull()
  })

  it('includes confluence, divergence and volatility', () => {
    const read = computeChartRead(Array.from({ length: 80 }, (_, i) => bar(i, 100 + i)))
    expect(Array.isArray(read.confluence)).toBe(true)
    expect(Array.isArray(read.divergence)).toBe(true)
    expect(read.volatility?.atrPct).toBeGreaterThan(0)
  })
})
