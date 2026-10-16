import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { detectRsiDivergence, renderDivergence } from './divergence'

const bar = (i: number, over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...over,
})

/**
 * Build a series from a list of closes, giving each bar a high/low bracket around its close so the
 * pivot finder sees the swings. The RSI follows the close-to-close deltas.
 */
function fromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => bar(i, { open: close, close, high: close + 1, low: close - 1 }))
}

describe('detectRsiDivergence', () => {
  it('finds NO divergence in a clean monotonic trend (RSI and price agree)', () => {
    const up = fromCloses(Array.from({ length: 60 }, (_, i) => 100 + i))
    expect(detectRsiDivergence(up)).toEqual([])
  })

  it('flags bullish divergence: price lower low, RSI higher low', () => {
    // Warm-up drift so RSI is established, a sharp drop to the first swing low (deep RSI), a
    // bounce, then a GENTLER drop to a marginally lower price low — the second selloff is weaker,
    // so RSI carves a higher low. Both swing lows land past the RSI warm-up. (Verified pivots:
    // price 81 @ RSI 25.5 → price 79 @ RSI 32.7.)
    const closes = [
      100, 101, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 104, 100, 95, 89, 82,
      90, 96, 99, 97, 94, 91, 88, 85, 82, 80, 84, 88,
    ]
    const found = detectRsiDivergence(fromCloses(closes), 2)
    const bullish = found.find((d) => d.kind === 'bullish')
    expect(bullish).toBeDefined()
    expect(bullish!.signalClass).toBe('regular')
    expect(bullish!.priceTo).toBeLessThan(bullish!.priceFrom) // lower low in price
    expect(bullish!.oscTo).toBeGreaterThan(bullish!.oscFrom) // higher low in RSI
    expect(bullish!.note).toContain('RSI higher low')
    expect(bullish!.note).toContain('reversal')
  })

  it('flags HIDDEN bullish divergence: price higher low, RSI lower low (continuation)', () => {
    // A rising trend that pulls back twice; the second pullback bottoms at a HIGHER price but a
    // sharper momentum dip, so RSI carves a lower low. (Verified pivots: price 126 @ RSI 83.5 →
    // price 135 @ RSI 67.8.)
    const closes = [
      100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 129, 127,
      128, 134, 140, 144, 148, 141, 136, 139, 145,
    ]
    const hidden = detectRsiDivergence(fromCloses(closes), 2).find(
      (d) => d.signalClass === 'hidden',
    )
    expect(hidden).toBeDefined()
    expect(hidden!.kind).toBe('bullish')
    expect(hidden!.priceTo).toBeGreaterThan(hidden!.priceFrom) // higher low in price
    expect(hidden!.oscTo).toBeLessThan(hidden!.oscFrom) // lower low in RSI
    expect(hidden!.note).toContain('continuation')
  })

  it('returns empty on too few bars for the RSI window', () => {
    expect(detectRsiDivergence(fromCloses([100, 101, 102, 103, 104]))).toEqual([])
  })

  it('renders findings as report lines, nothing when empty', () => {
    expect(renderDivergence([])).toEqual([])
    const lines = renderDivergence([
      {
        kind: 'bullish',
        signalClass: 'regular',
        priceFrom: 80,
        priceTo: 78,
        oscFrom: 25,
        oscTo: 35,
        time: 1,
        note: 'x',
      },
    ])
    expect(lines[0]).toContain('RSI divergence')
    expect(lines.join('\n')).toContain('bullish regular')
  })
})
