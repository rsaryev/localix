import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { hvPercentile, renderHvPercentile } from './hv-percentile'

const bar = (i: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  close,
  high: close + 1,
  low: close - 1,
  volume: 10,
})

const fromCloses = (closes: number[]): Candle[] => closes.map((c, i) => bar(i, c))

/** N closes wiggling ±`amp` around 100 — constant realized vol. */
const wiggle = (n: number, amp: number, base = 100): number[] =>
  Array.from({ length: n }, (_, i) => base + (i % 2 === 0 ? amp : -amp))

describe('hvPercentile', () => {
  it('returns null below the minimum rolling-HV sample count', () => {
    expect(hvPercentile(fromCloses(wiggle(30, 1)), '1h')).toBeNull()
  })

  it('a quiet tail after a noisy start ranks compressed; a noisy tail ranks elevated', () => {
    const noisyThenQuiet = [...wiggle(60, 3), ...wiggle(60, 0.3)]
    const quietThenNoisy = [...wiggle(60, 0.3), ...wiggle(60, 3)]

    const compressed = hvPercentile(fromCloses(noisyThenQuiet), '1h')!
    expect(compressed.state).toBe('compressed')
    expect(compressed.percentile).toBeLessThanOrEqual(20)

    const elevated = hvPercentile(fromCloses(quietThenNoisy), '1h')!
    expect(elevated.state).toBe('elevated')
    expect(elevated.percentile).toBeGreaterThanOrEqual(80)
  })

  it('annualizes on a 365-day year for a known timeframe, null for an unknown one', () => {
    const candles = fromCloses(wiggle(80, 1))
    const hourly = hvPercentile(candles, '1h')!
    expect(hourly.annualizedPct).not.toBeNull()
    // Same closes on a daily timeframe annualize with a smaller factor: √(365·24) vs √365.
    const daily = hvPercentile(candles, '1d')!
    expect(hourly.annualizedPct!).toBeGreaterThan(daily.annualizedPct!)
    expect(hourly.annualizedPct! / daily.annualizedPct!).toBeCloseTo(Math.sqrt(24), 5)

    expect(hvPercentile(candles, 'bogus')!.annualizedPct).toBeNull()
  })

  it('render leads with the rank and names the state', () => {
    const line = renderHvPercentile({
      annualizedPct: 42.3,
      percentile: 12,
      state: 'compressed',
      samples: 100,
    })[0]!
    expect(line).toContain('12th percentile')
    expect(line).toContain('42.3% annualized')
    expect(line).toContain('compressed')
    // An unknown timeframe drops the annualized clause but keeps the rank.
    const bare = renderHvPercentile({
      annualizedPct: null,
      percentile: 90,
      state: 'elevated',
      samples: 100,
    })[0]!
    expect(bare).not.toContain('annualized')
    expect(bare).toContain('elevated')
  })
})
