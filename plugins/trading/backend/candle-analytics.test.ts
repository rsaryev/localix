import { describe, expect, it } from 'bun:test'
import { maCrossBias, movingAverages, sma } from './candle-analytics'

describe('sma — trailing simple moving average', () => {
  it('averages the last `period` closes', () => {
    expect(sma([10, 20, 30, 40, 50], 3)).toBe(40) // (30+40+50)/3
    expect(sma([10, 20, 30, 40, 50], 5)).toBe(30)
  })

  it('is null when the window is too short — no partial, warped average', () => {
    expect(sma([10, 20], 3)).toBeNull()
    expect(sma([], 5)).toBeNull()
  })

  it('a non-positive period is null', () => {
    expect(sma([10, 20, 30], 0)).toBeNull()
    expect(sma([10, 20, 30], -1)).toBeNull()
  })

  it('period 1 is just the last close', () => {
    expect(sma([10, 20, 30], 1)).toBe(30)
  })
})

describe('movingAverages — several periods in one pass', () => {
  it('pairs each period with its trailing value, null where unmet', () => {
    const closes = Array.from({ length: 25 }, (_, i) => i + 1) // 1..25
    const [ma20, ma50] = movingAverages(closes, [20, 50])
    expect(ma20).toEqual({ period: 20, value: (6 + 25) / 2 }) // mean of 6..25 = 15.5
    expect(ma50).toEqual({ period: 50, value: null }) // only 25 closes
  })
})

describe('maCrossBias — the crossover read', () => {
  it('fast over slow is bullish, under is bearish, equal is flat', () => {
    expect(maCrossBias(110, 100)).toBe('bullish')
    expect(maCrossBias(90, 100)).toBe('bearish')
    expect(maCrossBias(100, 100)).toBe('flat')
  })

  it('is null when either average is unavailable — "unknown" is not "flat"', () => {
    expect(maCrossBias(null, 100)).toBeNull()
    expect(maCrossBias(110, null)).toBeNull()
    expect(maCrossBias(null, null)).toBeNull()
  })
})
