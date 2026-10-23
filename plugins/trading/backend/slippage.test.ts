import { describe, expect, test } from 'bun:test'
import type { OrderBookLevel } from './contracts'
import { depthTotals, estimateSlippage, orderBookSpread } from './slippage'

describe('estimateSlippage', () => {
  const asks: OrderBookLevel[] = [
    [100, 1],
    [101, 1],
    [102, 5],
  ]
  const bids: OrderBookLevel[] = [
    [99, 1],
    [98, 1],
    [97, 5],
  ]

  test('a buy walks the asks up from the best ask', () => {
    // 1.5 filled: 1@100 + 0.5@101 → vwap = (100 + 50.5)/1.5 = 100.333…; ref 100.
    const est = estimateSlippage({ bids, asks }, 'buy', 1.5)
    expect(est).not.toBeNull()
    expect(est!.referencePrice).toBe(100)
    expect(est!.avgPrice).toBeCloseTo(150.5 / 1.5, 8)
    expect(est!.slippage).toBeCloseTo((150.5 / 1.5 - 100) / 100, 8)
    expect(est!.enoughDepth).toBe(true)
    expect(est!.filled).toBeCloseTo(1.5, 10)
  })

  test('a sell walks the bids down from the best bid — slippage stays non-negative', () => {
    const est = estimateSlippage({ bids, asks }, 'sell', 1.5)
    expect(est!.referencePrice).toBe(99)
    // 1@99 + 0.5@98 → vwap 98.666…, worse than 99 → positive slippage.
    expect(est!.avgPrice).toBeCloseTo(148 / 1.5, 8)
    expect(est!.slippage).toBeGreaterThan(0)
  })

  test('a size larger than visible depth is a LOWER BOUND', () => {
    const est = estimateSlippage({ bids, asks }, 'buy', 100)
    expect(est!.enoughDepth).toBe(false)
    expect(est!.filled).toBeCloseTo(7, 10) // 1 + 1 + 5
  })

  test('an empty book side yields no estimate — never 0%', () => {
    expect(estimateSlippage({ bids: [], asks: [] }, 'buy', 1)).toBeNull()
  })

  test('a zero / negative size yields no estimate', () => {
    expect(estimateSlippage({ bids, asks }, 'buy', 0)).toBeNull()
  })

  test('a size that sits at the top of book has ~zero slippage, not negative', () => {
    const est = estimateSlippage({ bids, asks }, 'buy', 1)
    expect(est!.slippage).toBe(0)
  })
})

describe('a book made only of unusable levels fills nothing', () => {
  test('zero/negative amounts leave nothing filled → null, never a 0% estimate', () => {
    // The side is non-empty, so the early `levels.length === 0` guard does not fire. Every level is
    // unusable, so nothing is filled — and an estimate of `0%` here would tell a trader this size
    // costs nothing to take.
    const asks: OrderBookLevel[] = [
      [100, 0],
      [101, -1],
    ]
    expect(estimateSlippage({ bids: [], asks }, 'buy', 1)).toBeNull()
  })

  test('a non-positive reference price is not a price', () => {
    expect(estimateSlippage({ bids: [], asks: [[0, 5]] }, 'buy', 1)).toBeNull()
  })
})

describe('orderBookSpread', () => {
  test('computes best bid/ask, mid, spread and bps from best-first levels', () => {
    const bids: OrderBookLevel[] = [
      [100, 2],
      [99, 5],
    ]
    const asks: OrderBookLevel[] = [
      [101, 3],
      [102, 4],
    ]
    const s = orderBookSpread(bids, asks)
    expect(s.bestBid).toBe(100)
    expect(s.bestAsk).toBe(101)
    expect(s.mid).toBe(100.5)
    expect(s.spread).toBe(1)
    expect(s.spreadBps).toBeCloseTo((1 / 100.5) * 10000, 6)
  })

  test('is order-independent — re-sorts defensively', () => {
    const bids: OrderBookLevel[] = [
      [99, 5],
      [100, 2],
    ]
    const asks: OrderBookLevel[] = [
      [102, 4],
      [101, 3],
    ]
    const s = orderBookSpread(bids, asks)
    expect(s.bestBid).toBe(100)
    expect(s.bestAsk).toBe(101)
    expect(s.spread).toBe(1)
  })

  test('an empty side yields null, never a fabricated tight book', () => {
    expect(orderBookSpread([], [[101, 1]])).toEqual({
      bestBid: null,
      bestAsk: 101,
      mid: null,
      spread: null,
      spreadBps: null,
    })
    expect(orderBookSpread([[100, 1]], [])).toEqual({
      bestBid: 100,
      bestAsk: null,
      mid: null,
      spread: null,
      spreadBps: null,
    })
    expect(orderBookSpread([], [])).toEqual({
      bestBid: null,
      bestAsk: null,
      mid: null,
      spread: null,
      spreadBps: null,
    })
  })
})

describe('depthTotals — resting size on each side (order-book imbalance)', () => {
  test('sums each side over the depth and reports the bid share', () => {
    const bids: OrderBookLevel[] = [
      [100, 3],
      [99, 5],
    ]
    const asks: OrderBookLevel[] = [
      [101, 1],
      [102, 1],
    ]
    const d = depthTotals(bids, asks, 5)
    expect(d.bidSize).toBe(8)
    expect(d.askSize).toBe(2)
    expect(d.bidShare).toBeCloseTo(0.8, 10)
  })

  test('honors the depth cap — levels past it do not count', () => {
    const bids: OrderBookLevel[] = [
      [100, 3],
      [99, 100],
    ]
    const asks: OrderBookLevel[] = [[101, 3]]
    const d = depthTotals(bids, asks, 1)
    expect(d.bidSize).toBe(3)
    expect(d.askSize).toBe(3)
    expect(d.bidShare).toBeCloseTo(0.5, 10)
  })

  test('ignores non-positive / non-finite sizes', () => {
    const bids: OrderBookLevel[] = [
      [100, 0],
      [99, -1],
    ]
    const asks: OrderBookLevel[] = [[101, 4]]
    const d = depthTotals(bids, asks, 5)
    expect(d.bidSize).toBe(0)
    expect(d.askSize).toBe(4)
    expect(d.bidShare).toBe(0)
  })

  test('an all-empty book yields a null share, never a fabricated 0.5', () => {
    expect(depthTotals([], [], 5).bidShare).toBeNull()
    expect(depthTotals([[100, 0]], [], 5).bidShare).toBeNull()
  })
})
