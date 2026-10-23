import { describe, expect, it } from 'bun:test'
import { fibDrawPayloads, fibRetracement, renderFibRetracement } from './fib-retracement'
import { parseChartCommandPayload } from '../chart-command'
import type { Candle } from '../contracts'

const bar = (i: number, high: number, low: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: (high + low) / 2,
  close: (high + low) / 2,
  high,
  low,
  volume: 10,
})

// Swing from low 100 to high 200 (range 100) across the window.
const window: Candle[] = [bar(0, 110, 100), bar(1, 160, 130), bar(2, 200, 180), bar(3, 190, 170)]

describe('fibRetracement', () => {
  it('measures DOWN from the high in an up-leg (pullback support)', () => {
    const fib = fibRetracement(window, 'up')!
    expect(fib.direction).toBe('up')
    expect(fib.swingHigh).toBe(200)
    expect(fib.swingLow).toBe(100)
    const at = (r: number) => fib.levels.find((l) => l.ratio === r)!.price
    expect(at(0.382)).toBeCloseTo(200 - 38.2, 5) // 161.8
    expect(at(0.5)).toBeCloseTo(150, 5)
    expect(at(0.618)).toBeCloseTo(200 - 61.8, 5) // 138.2
  })

  it('measures UP from the low in a down-leg (bounce resistance)', () => {
    const fib = fibRetracement(window, 'down')!
    expect(fib.direction).toBe('down')
    const at = (r: number) => fib.levels.find((l) => l.ratio === r)!.price
    expect(at(0.382)).toBeCloseTo(100 + 38.2, 5) // 138.2
    expect(at(0.618)).toBeCloseTo(161.8, 5)
  })

  it('a flat trend defaults to the up-leg reading', () => {
    expect(fibRetracement(window, 'flat')!.direction).toBe('up')
  })

  it('returns null on a rangeless series', () => {
    expect(fibRetracement([bar(0, 100, 100), bar(1, 100, 100)], 'up')).toBeNull()
  })

  it('renders the swing, the key trio, and the role', () => {
    const text = renderFibRetracement(fibRetracement(window, 'up')!).join('\n')
    expect(text).toContain('swing 100→200')
    expect(text).toContain('50.0%')
    expect(text).toContain('pullback support')
  })

  it('draws the golden-pocket zone and the 50% line as valid, stable-id overlays', () => {
    const payloads = fibDrawPayloads('c1', 'BTC/USDC:USDC', fibRetracement(window, 'up')!)
    for (const p of payloads) {
      expect(parseChartCommandPayload(p)).toEqual(p) // round-trips the sink guard
      expect(p.drawMode).toBe('add')
      expect(p.drawing!.id).toMatch(/^fib-/)
    }
    // Stable ids so a re-detect replaces rather than stacks.
    expect(payloads.map((p) => p.drawing!.id)).toEqual(['fib-golden', 'fib-500'])
    const zone = payloads[0]!.drawing!
    expect(zone.kind).toBe('zone')
    // Golden pocket = the band between the 0.618 and 0.786 levels (up-leg: 200 − r·100).
    expect((zone as { price1: number }).price1).toBeCloseTo(200 - 61.8, 5)
    expect((zone as { price2: number }).price2).toBeCloseTo(200 - 78.6, 5)
    expect(payloads[1]!.drawing!.kind).toBe('hline')
  })
})
