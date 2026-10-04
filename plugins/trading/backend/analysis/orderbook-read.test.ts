import { describe, expect, it } from 'bun:test'
import type { OrderBook } from '../contracts'
import { orderBookRead, renderOrderBookRead } from './orderbook-read'

const book = (bids: Array<[number, number]>, asks: Array<[number, number]>): OrderBook => ({
  symbol: 'BTC/USDC:USDC',
  bids,
  asks,
})

describe('orderBookRead', () => {
  it('null on an empty/crossed book', () => {
    expect(orderBookRead(book([], [[100, 1]]))).toBeNull()
    expect(orderBookRead(book([[101, 1]], [[100, 1]]))).toBeNull() // crossed
    expect(orderBookRead(null)).toBeNull()
  })

  it('spread as a percent of mid; imbalance over the shared level count', () => {
    const r = orderBookRead(
      book(
        [
          [99.9, 3],
          [99.8, 3],
        ],
        [
          [100.1, 1],
          [100.2, 1],
        ],
      ),
    )!
    expect(r.mid).toBeCloseTo(100, 10)
    expect(r.spreadPct).toBeCloseTo(0.2, 10)
    expect(r.levels).toBe(2)
    expect(r.imbalance).toBeCloseTo((6 - 2) / 8, 10)
    expect(r.state).toBe('bid_heavy')
    // Microprice = bid·(vAsk/ΣV) + ask·(vBid/ΣV) = 99.9·(2/8) + 100.1·(6/8) = 100.05,
    // i.e. +0.05% above mid — the heavy bid queue pulls fair value up toward the ask.
    expect(r.micropricePct).toBeCloseTo(0.05, 6)
  })

  it('microprice sits at mid when the book is symmetric, and renders when it is not', () => {
    const symmetric = orderBookRead(book([[99.9, 5]], [[100.1, 5]]))!
    expect(symmetric.micropricePct).toBeCloseTo(0, 10)
    expect(renderOrderBookRead(symmetric).join('\n')).not.toContain('microprice')

    const bidHeavy = orderBookRead(book([[99.9, 9]], [[100.1, 1]]))!
    expect(bidHeavy.micropricePct).toBeGreaterThan(0) // fair value leans up
    expect(renderOrderBookRead(bidHeavy).join('\n')).toContain('fair value leans up')
  })

  it('classifies the lean bands and renders the timing caveat', () => {
    const balanced = orderBookRead(book([[99.9, 5]], [[100.1, 5]]))!
    expect(balanced.state).toBe('balanced')
    const askHeavy = orderBookRead(book([[99.9, 1]], [[100.1, 5]]))!
    expect(askHeavy.state).toBe('ask_heavy')
    const line = renderOrderBookRead(askHeavy).join('\n')
    expect(line).toContain('ask-heavy')
    expect(line).toContain('NEXT TICKS down')
    expect(line).toContain('not a level for the plan')
  })
})
