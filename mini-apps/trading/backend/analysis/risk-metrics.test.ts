import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { renderRiskMetrics, riskMetrics } from './risk-metrics'

const bar = (i: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  close,
  high: close + 1,
  low: close - 1,
  volume: 10,
})

const fromCloses = (closes: number[]): Candle[] => closes.map((c, i) => bar(i, c))

describe('riskMetrics', () => {
  it('returns null below the minimum sample count', () => {
    expect(riskMetrics(fromCloses([100, 101, 102, 103]))).toBeNull()
  })

  it('CVaR is at least as severe as VaR, and drawdown is captured', () => {
    // A gently rising series with one sharp down-bar (the tail) and a mid-window dip.
    const closes = [
      100, 101, 102, 101, 103, 104, 103, 105, 106, 105, 107, 108, 92, 94, 96, 98, 100, 102, 101,
      103, 104, 106, 105, 107, 108,
    ]
    const m = riskMetrics(fromCloses(closes))!
    expect(m).not.toBeNull()
    expect(m.samples).toBe(closes.length - 1)
    expect(m.var95).toBeGreaterThan(0)
    expect(m.cvar95).toBeGreaterThanOrEqual(m.var95) // expected shortfall never milder than VaR
    // The 108→92 drop is the deepest peak-to-trough: ~14.8%.
    expect(m.maxDrawdown).toBeGreaterThan(14)
    expect(m.maxDrawdown).toBeLessThan(16)
  })

  it('a strictly rising series reports no loss (VaR clamped at 0)', () => {
    const m = riskMetrics(fromCloses(Array.from({ length: 40 }, (_, i) => 100 + i)))!
    expect(m.var95).toBe(0)
    expect(m.maxDrawdown).toBe(0)
  })

  it('renders figures with the not-a-ceiling caveat', () => {
    const m = riskMetrics(fromCloses(Array.from({ length: 40 }, (_, i) => 100 + (i % 3) - 1)))
    const text = renderRiskMetrics(m!, '1h').join('\n')
    expect(text).toContain('95% VaR')
    expect(text).toContain('CVaR')
    expect(text).toContain('max drawdown')
    expect(text).toContain('not a loss ceiling')
  })
})
