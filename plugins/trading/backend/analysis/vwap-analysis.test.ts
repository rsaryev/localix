import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { renderSessionVwap, sessionVwap } from './vwap-analysis'

const HOUR = 3600
const bar = (time: number, high: number, low: number, close: number, volume: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume,
})

describe('sessionVwap', () => {
  it('volume-weights the typical price of the current UTC day', () => {
    // All in UTC day 0. Two bars: tp 100 (vol 3) and tp 110 (vol 1) → VWAP (300+110)/4 = 102.5.
    const v = sessionVwap([
      bar(0, 100, 100, 100, 3),
      bar(HOUR, 110, 110, 110, 1),
      bar(2 * HOUR, 110, 110, 110, 0), // adds a third bar; zero volume doesn't move VWAP
    ])!
    expect(v.vwap).toBeCloseTo(102.5, 6)
    // Last close 110 is above VWAP → positive distance, intraday-bullish.
    expect(v.distancePct).toBeGreaterThan(0)
    expect(v.upper).toBeGreaterThan(v.vwap)
    expect(v.lower).toBeLessThan(v.vwap)
  })

  it('only counts the CURRENT day, not prior days in the window', () => {
    const v = sessionVwap([
      bar(0, 50, 50, 50, 100), // day 0 — should be ignored
      bar(DAY(), 100, 100, 100, 1),
      bar(DAY() + HOUR, 100, 100, 100, 1),
      bar(DAY() + 2 * HOUR, 100, 100, 100, 1),
    ])!
    expect(v.vwap).toBeCloseTo(100, 6) // day 0's 50 does not drag it down
  })

  it('is null when the current day has no volume', () => {
    expect(
      sessionVwap([
        bar(0, 100, 100, 100, 0),
        bar(HOUR, 100, 100, 100, 0),
        bar(2 * HOUR, 100, 100, 100, 0),
      ]),
    ).toBeNull()
  })

  it('is null with too few bars in the day', () => {
    expect(sessionVwap([bar(0, 100, 100, 100, 5)])).toBeNull()
  })
})

function DAY() {
  return 86_400
}

describe('renderSessionVwap', () => {
  it('renders the VWAP, price side and the sigma band', () => {
    const text = renderSessionVwap({ vwap: 100, upper: 102, lower: 98, distancePct: 1.5 }).join('')
    expect(text).toContain('session VWAP')
    expect(text).toContain('intraday-bullish')
    expect(text).toContain('±1σ band 98–102')
  })

  it('renders nothing for null', () => {
    expect(renderSessionVwap(null)).toHaveLength(0)
  })
})
