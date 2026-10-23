import { describe, expect, it } from 'bun:test'
import type { PublicTrade } from '../../backend/contracts'
import { tradeFlow } from './tradeFlow'

const print = (side: 'buy' | 'sell', amount: number): PublicTrade => ({
  id: `${side}-${amount}-${Math.random()}`,
  timestamp: 0,
  price: 100,
  amount,
  side,
})

describe('tradeFlow', () => {
  it('is the buy share of executed volume, not count', () => {
    // One big buy (9) outweighs three small sells (1 each) → 9/12 = 0.75.
    const flow = tradeFlow([print('buy', 9), print('sell', 1), print('sell', 1), print('sell', 1)])!
    expect(flow.buyShare).toBeCloseTo(0.75, 10)
    expect(flow.buyVolume).toBe(9)
    expect(flow.sellVolume).toBe(3)
  })

  it('returns null with no volume — never a fabricated 50/50', () => {
    expect(tradeFlow([])).toBeNull()
    expect(tradeFlow([print('buy', 0), print('sell', 0)])).toBeNull()
  })

  it('reads 1 when every print is a buy', () => {
    expect(tradeFlow([print('buy', 2), print('buy', 3)])!.buyShare).toBe(1)
  })
})
