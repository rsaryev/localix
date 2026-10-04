import { describe, expect, test } from 'bun:test'
import { buildOrderBook } from './orderBookRows'
import { readCode } from '@localixai/source-lint'

describe('buildOrderBook', () => {
  test('cumulates size best-first and derives a shared depth ratio', () => {
    const view = buildOrderBook(
      [
        [100, 2],
        [99, 3],
      ],
      [
        [101, 1],
        [102, 4],
      ],
    )
    expect(view.bids.map((r) => r.total)).toEqual([2, 5])
    expect(view.asks.map((r) => r.total)).toEqual([1, 5])
    // Shared scale = max final cumulative (5) → last row of each side is 1.0.
    expect(view.bids.at(-1)?.ratio).toBe(1)
    expect(view.asks.at(-1)?.ratio).toBe(1)
    expect(view.asks[0]?.ratio).toBeCloseTo(0.2, 5)
  })

  test('computes mid, spread and spread in bps', () => {
    const view = buildOrderBook([[100, 1]], [[102, 1]])
    expect(view.mid).toBe(101)
    expect(view.spread).toBe(2)
    expect(view.spreadBps).toBeCloseTo((2 / 101) * 10000, 5)
  })

  test('computes the bid share of visible depth for the pressure bar', () => {
    const view = buildOrderBook([[100, 3]], [[102, 1]])
    expect(view.bidShare).toBeCloseTo(0.75, 10)
    // Empty book → null share, never a fabricated 0.5.
    expect(buildOrderBook([], []).bidShare).toBeNull()
  })

  test('re-sorts unsorted input to best-first', () => {
    const view = buildOrderBook(
      [
        [98, 1],
        [100, 1],
      ],
      [
        [103, 1],
        [101, 1],
      ],
    )
    expect(view.bids[0]?.price).toBe(100)
    expect(view.asks[0]?.price).toBe(101)
    expect(view.mid).toBe(100.5)
  })

  test('one empty side → null mid/spread', () => {
    const view = buildOrderBook([[100, 1]], [])
    expect(view.mid).toBeNull()
    expect(view.spread).toBeNull()
    expect(view.spreadBps).toBeNull()
    expect(view.bids).toHaveLength(1)
  })

  test('respects the depth cap', () => {
    const bids = Array.from({ length: 30 }, (_, i) => [100 - i, 1] as [number, number])
    expect(buildOrderBook(bids, [], 10).bids).toHaveLength(10)
  })
})

describe('the order book renders a buy/sell-pressure bar from bidShare (source lint)', () => {
  const ui = readCode(new URL('../ui/OrderBook.tsx', import.meta.url))
  test('the bar is gated on view.bidShare != null, never a fabricated 50/50', () => {
    expect(ui).toContain('view.bidShare != null')
    expect(ui).toContain('width: `${view.bidShare * 100}%`')
  })
})
