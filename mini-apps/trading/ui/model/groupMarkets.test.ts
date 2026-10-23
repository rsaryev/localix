import { describe, expect, test } from 'bun:test'
import type { Market, MarketType } from '../../backend/contracts'
import { groupMarkets } from './groupMarkets'

const m = (symbol: string, type: MarketType = 'spot'): Market => {
  const [base, quote] = symbol.split(/[/:]/)
  return {
    symbol,
    base,
    quote: quote ?? 'USDC',
    type,
    active: true,
    contract: type !== 'spot',
    precision: {},
    limits: {},
  }
}

describe('groupMarkets', () => {
  test('groups by type in a fixed order', () => {
    const g = groupMarkets([m('ETH/USDC', 'swap'), m('BTC/USDC', 'spot'), m('SOL/USDC', 'spot')])
    expect(g.groups.map((x) => x.key)).toEqual(['type:spot', 'type:swap'])
    expect(g.groups[0]?.markets.map((x) => x.symbol)).toEqual(['BTC/USDC', 'SOL/USDC'])
    expect(g.total).toBe(3)
  })

  test('favourites float into their own group first', () => {
    const g = groupMarkets([m('BTC/USDC'), m('ETH/USDC'), m('SOL/USDC')], {
      favourites: new Set(['ETH/USDC']),
    })
    expect(g.groups[0]?.key).toBe('favourites')
    expect(g.groups[0]?.markets.map((x) => x.symbol)).toEqual(['ETH/USDC'])
    // A favourite is NOT duplicated into its type group.
    const spot = g.groups.find((x) => x.key === 'type:spot')
    expect(spot?.markets.map((x) => x.symbol)).toEqual(['BTC/USDC', 'SOL/USDC'])
  })

  test('filters by query over symbol/base/quote', () => {
    const list = [m('BTC/USDC'), m('ETH/USDT'), m('SOL/USDC')]
    expect(groupMarkets(list, { query: 'eth' }).total).toBe(1)
    expect(groupMarkets(list, { query: 'usdc' }).total).toBe(2)
    expect(groupMarkets(list, { query: '' }).total).toBe(3)
  })

  test('filters by market type', () => {
    const list = [m('BTC/USDC', 'spot'), m('ETH/USDC:USDC', 'swap')]
    expect(groupMarkets(list, { type: 'swap' }).total).toBe(1)
    expect(groupMarkets(list, { type: 'all' }).total).toBe(2)
  })

  test('caps the total and reports it (favourites counted in the cap)', () => {
    const list = Array.from({ length: 10 }, (_, i) => m(`C${i}/USDC`))
    const g = groupMarkets(list, { cap: 3 })
    expect(g.shown).toBe(3)
    expect(g.capped).toBe(true)
    expect(g.total).toBe(10)
  })
})
