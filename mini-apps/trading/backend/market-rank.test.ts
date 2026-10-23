import { describe, expect, test } from 'bun:test'
import type { Market, MarketType } from './contracts'
import { rankMarkets } from './market-rank'

const m = (symbol: string, type: MarketType, active = true): Market => ({
  symbol,
  base: symbol.split('/')[0],
  quote: 'USDC',
  type,
  active,
  contract: type !== 'spot',
  precision: {},
  limits: {},
})

/** The Hyperliquid shape: every spot market ahead of every perpetual in the venue's own order. */
function hyperliquidLike(): Market[] {
  const spot = Array.from({ length: 299 }, (_, i) =>
    m(`SPOT${String(i).padStart(3, '0')}/USDC`, 'spot'),
  )
  const swap = Array.from({ length: 456 }, (_, i) =>
    m(`PERP${String(i).padStart(3, '0')}/USDC:USDC`, 'swap'),
  )
  return [...spot, ...swap]
}

describe('rankMarkets', () => {
  test('an off-the-top cap kept ZERO perpetuals; a fair share keeps both types', () => {
    const all = hyperliquidLike()
    expect(all.slice(0, 200).filter((x) => x.type === 'swap')).toHaveLength(0) // the old behaviour

    const { markets, total, capped } = rankMarkets(all, 200)
    expect(total).toBe(755)
    expect(capped).toBe(true)
    expect(markets).toHaveLength(200)
    expect(markets.filter((x) => x.type === 'spot')).toHaveLength(100)
    expect(markets.filter((x) => x.type === 'swap')).toHaveLength(100)
  })

  test('a type with fewer markets than its share hands the leftover to the others', () => {
    const all = [
      m('A/USDC', 'spot'),
      ...Array.from({ length: 20 }, (_, i) => m(`P${i}/USDC:USDC`, 'swap')),
    ]
    const { markets } = rankMarkets(all, 10)
    expect(markets).toHaveLength(10)
    // Spot could only use 1 of its 5; the swaps take the remaining 9.
    expect(markets.filter((x) => x.type === 'spot')).toHaveLength(1)
    expect(markets.filter((x) => x.type === 'swap')).toHaveLength(9)
  })

  test('each type is alphabetical, so a major symbol is not buried at position 140', () => {
    const all = [m('ZZZ/USDC', 'spot'), m('BTC/USDC', 'spot'), m('AAA/USDC', 'spot')]
    expect(rankMarkets(all, 3).markets.map((x) => x.symbol)).toEqual([
      'AAA/USDC',
      'BTC/USDC',
      'ZZZ/USDC',
    ])
  })

  test('inactive markets sort behind active ones — listable is not tradable', () => {
    const all = [m('AAA/USDC', 'spot', false), m('ZZZ/USDC', 'spot', true)]
    expect(rankMarkets(all, 2).markets.map((x) => x.symbol)).toEqual(['ZZZ/USDC', 'AAA/USDC'])
  })

  test('types come out in display order', () => {
    const all = [m('P/USDC:USDC', 'swap'), m('S/USDC', 'spot')]
    expect(rankMarkets(all, 2).markets.map((x) => x.type)).toEqual(['spot', 'swap'])
  })

  test('nothing is dropped when the cap covers the roster', () => {
    const all = [m('A/USDC', 'spot'), m('B/USDC:USDC', 'swap')]
    const r = rankMarkets(all, 50)
    expect(r.capped).toBe(false)
    expect(r.markets).toHaveLength(2)
  })

  test('a non-positive cap yields nothing, and admits it dropped something', () => {
    expect(rankMarkets([m('A/USDC', 'spot')], 0)).toEqual({ markets: [], total: 1, capped: true })
    expect(rankMarkets([], 0)).toEqual({ markets: [], total: 0, capped: false })
  })
})
