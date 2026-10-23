import { describe, expect, test } from 'bun:test'
import type { PublicTrade } from '../../backend/contracts'
import { reconcileTrades, TRADE_TAPE_LIMIT, tradeKey } from './streamReconcile'

const trade = (over: Partial<PublicTrade> & { timestamp: number }): PublicTrade => ({
  price: 100,
  amount: 1,
  side: 'buy',
  ...over,
})

describe('reconcileTrades', () => {
  test('prepends the batch newest-first onto the existing tape', () => {
    const prev = [trade({ id: 'c', timestamp: 3 })]
    // Venue batch is oldest→newest.
    const incoming = [trade({ id: 'd', timestamp: 4 }), trade({ id: 'e', timestamp: 5 })]
    const next = reconcileTrades(prev, incoming)
    expect(next.map((t) => t.id)).toEqual(['e', 'd', 'c'])
  })

  test('de-duplicates against the current tape and within the batch', () => {
    const prev = [trade({ id: 'b', timestamp: 2 }), trade({ id: 'a', timestamp: 1 })]
    const incoming = [
      trade({ id: 'a', timestamp: 1 }),
      trade({ id: 'c', timestamp: 3 }),
      trade({ id: 'c', timestamp: 3 }),
    ]
    const next = reconcileTrades(prev, incoming)
    expect(next.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  test('returns the SAME reference when nothing new arrives', () => {
    const prev = [trade({ id: 'a', timestamp: 1 })]
    expect(reconcileTrades(prev, [])).toBe(prev)
    expect(reconcileTrades(prev, [trade({ id: 'a', timestamp: 1 })])).toBe(prev)
  })

  test('bounds the tape to the newest `limit`', () => {
    const prev = Array.from({ length: TRADE_TAPE_LIMIT }, (_, i) =>
      trade({ id: `p${i}`, timestamp: 1000 + i }),
    )
    const next = reconcileTrades(prev, [trade({ id: 'new', timestamp: 9999 })])
    expect(next.length).toBe(TRADE_TAPE_LIMIT)
    expect(next[0]?.id).toBe('new')
    // Prepending 'new' pushed the oldest tail row (p99) off the bounded tape.
    expect(next.at(-1)?.id).toBe('p98')
  })

  test('custom limit is honoured', () => {
    const prev = [trade({ id: 'b', timestamp: 2 }), trade({ id: 'a', timestamp: 1 })]
    const next = reconcileTrades(prev, [trade({ id: 'c', timestamp: 3 })], 2)
    expect(next.map((t) => t.id)).toEqual(['c', 'b'])
  })

  test('tradeKey falls back to a value fingerprint for idless trades', () => {
    expect(tradeKey(trade({ timestamp: 7, price: 42, amount: 2, side: 'sell' }))).toBe(
      '7:42:2:sell',
    )
    expect(tradeKey(trade({ id: 'x', timestamp: 7 }))).toBe('x')
  })
})
