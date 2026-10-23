import { searchHitsOf } from '@localixai/mini-app-sdk/backend'
import { describe, expect, test } from 'bun:test'
import {
  createTradingSearchProvider,
  marketSubtitle,
  type TradingSearchMarket,
  type TradingSearchPort,
} from './search-provider'

const conn = { id: 'c1', name: 'hl', exchangeId: 'hyperliquid', connected: true }

function port(markets: TradingSearchMarket[]): TradingSearchPort {
  return { listConnections: async () => [conn], listMarkets: async () => markets }
}

const market = (symbol: string, operator?: string): TradingSearchMarket => {
  const [base, rest] = symbol.split('/')
  return {
    symbol,
    base,
    quote: rest.split(':')[0],
    type: symbol.includes(':') ? 'swap' : 'spot',
    ...(operator ? { operator } : {}),
  }
}

/** The Hyperliquid shape: every spot market listed before any perpetual. */
function rosterWithSpotFirst(): TradingSearchMarket[] {
  const spot = Array.from({ length: 40 }, (_, i) => market(`BTCX${i}/USDC`))
  return [...spot, market('BTC/USDC:USDC')]
}

const search = async (p: TradingSearchPort, text: string) =>
  searchHitsOf(await createTradingSearchProvider(p).search('u', { text } as never)).filter(
    (h) => h.icon === 'market',
  )

describe('trading search provider', () => {
  test('keeps the BEST-scoring markets, not the first the venue happened to list', async () => {
    const hits = await search(port(rosterWithSpotFirst()), 'BTC/USDC:USDC')
    // The exact symbol is the last of 41 matches in the venue's order. Truncating before scoring
    // filled the 25-hit quota with near-misses and dropped the one the user typed.
    expect(hits[0]?.title).toBe('BTC/USDC:USDC')
  })

  test('the hit cap still applies, and the cut is deterministic', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      market(`AAA${String(i).padStart(2, '0')}/USDC`),
    )
    const first = await search(port(many), 'AAA')
    const second = await search(port(many), 'AAA')
    expect(first).toHaveLength(25)
    expect(first.map((h) => h.title)).toEqual(second.map((h) => h.title))
  })

  test('a market nobody asked for is not a hit', async () => {
    expect(await search(port([market('ETH/USDC:USDC')]), 'sol')).toHaveLength(0)
  })
})

// A hit's subtitle carries what the symbol does NOT: whether it is leveraged, and who deployed it.
describe('marketSubtitle', () => {
  test('a spot hit does not spell its own symbol back at itself', () => {
    expect(marketSubtitle('hl', market('AAPL/USDC'))).toBe('hl · spot')
  })

  test('the market type is always named — BTC/USDC and BTC/USDC:USDC are different trades', () => {
    expect(marketSubtitle('hl', market('BTC/USDC'))).toBe('hl · spot')
    expect(marketSubtitle('hl', market('BTC/USDC:USDC'))).toBe('hl · BTC/USDC · swap')
  })

  test('a builder market names its operator — Hyperliquid lists AAPL four times', () => {
    expect(marketSubtitle('hl', market('XYZ-AAPL/USDC:USDC', 'xyz'))).toBe(
      'hl · XYZ-AAPL/USDC · swap · by xyz',
    )
  })

  test("the exchange's own market claims no operator", () => {
    expect(marketSubtitle('hl', market('AAPL/USDC'))).not.toContain('by')
  })

  test('an inactive market is flagged — a hit must not read as tradable when it is not', () => {
    expect(marketSubtitle('hl', { ...market('BTC/USDC:USDC'), active: false })).toContain(
      'inactive',
    )
    expect(marketSubtitle('hl', { ...market('BTC/USDC:USDC'), active: true })).not.toContain(
      'inactive',
    )
    // Unknown activity (the venue did not report it) says nothing extra rather than guessing.
    expect(marketSubtitle('hl', market('BTC/USDC:USDC'))).not.toContain('inactive')
  })
})
