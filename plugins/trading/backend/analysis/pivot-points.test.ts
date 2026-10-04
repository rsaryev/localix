import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { pivotPoints, renderPivotPoints } from './pivot-points'

const DAY = 86_400

const bar = (time: number, high: number, low: number, close: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 10,
})

describe('pivotPoints', () => {
  it('derives the current day pivots from the prior day HLC', () => {
    // Prior day (day 0): high 110, low 90, close 100 → PP 100, range 20.
    const candles = [
      bar(0, 105, 95, 100),
      bar(3600, 110, 90, 102), // prior-day high 110, low 90
      bar(7200, 108, 98, 100), // prior-day last close 100
      bar(DAY, 101, 99, 100), // day 1 = "today"
    ]
    const p = pivotPoints(candles)!
    expect(p.pp).toBeCloseTo(100, 5) // (110+90+100)/3
    expect(p.r1).toBeCloseTo(110, 5) // 2·100 − 90
    expect(p.s1).toBeCloseTo(90, 5) // 2·100 − 110
    expect(p.r2).toBeCloseTo(120, 5) // 100 + 20
    expect(p.s2).toBeCloseTo(80, 5) // 100 − 20
  })

  it('orders as R2 > R1 > PP > S1 > S2', () => {
    const p = pivotPoints([bar(0, 110, 90, 100), bar(DAY, 101, 99, 100)])!
    expect(p.r2).toBeGreaterThan(p.r1)
    expect(p.r1).toBeGreaterThan(p.pp)
    expect(p.pp).toBeGreaterThan(p.s1)
    expect(p.s1).toBeGreaterThan(p.s2)
  })

  it('returns null with fewer than two UTC days loaded', () => {
    expect(pivotPoints([bar(0, 110, 90, 100), bar(3600, 108, 98, 101)])).toBeNull()
  })

  it('renders one line with all five levels', () => {
    const text = renderPivotPoints(
      pivotPoints([bar(0, 110, 90, 100), bar(DAY, 101, 99, 100)])!,
    ).join('\n')
    expect(text).toContain('daily pivots')
    expect(text).toContain('PP 100')
    expect(text).toContain('R1')
    expect(text).toContain('S2')
  })
})
