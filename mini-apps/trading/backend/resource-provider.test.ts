import { describe, expect, test } from 'bun:test'
import { createTradingResourceProvider, type ResourceTradingService } from './resource-provider'
import type { ExchangeInfo, Market, Ticker } from './contracts'

/**
 * The `localix://resource/trade/` tree, now that every source is a PUBLIC venue profile.
 *
 * What is worth pinning: the roots are the venue catalog (there are no saved rows to list), a
 * venue drills straight to its markets, every market leaf is public, and a failing read is
 * reported rather than rendered as an empty market.
 */

const MARKET: Market = {
  symbol: 'BTC/USDC:USDC',
  base: 'BTC',
  quote: 'USDC',
  type: 'swap',
  active: true,
  contract: true,
  precision: { price: 1, amount: 0.001 },
  limits: {},
}

const INFO = {
  id: 'binance',
  name: 'Binance',
  capabilities: { orderBook: true, trades: true, fundingRate: 'native', openInterest: true },
} as unknown as ExchangeInfo

function stub(over: Partial<ResourceTradingService> = {}): ResourceTradingService {
  return {
    exchanges: async () => [{ id: 'binance', name: 'Binance', requiredCredentials: [] }],
    describe: async () => INFO,
    markets: async () => [MARKET],
    ticker: async (): Promise<Ticker> => ({ symbol: MARKET.symbol, last: 63000 }) as Ticker,
    ohlcv: async () => [],
    orderBook: async () => ({ symbol: MARKET.symbol, bids: [], asks: [] }),
    trades: async () => [],
    fundingRate: async () => null,
    openInterest: async () => null,
    ...over,
  } as unknown as ResourceTradingService
}

describe('trading resource provider', () => {
  test('the roots are the venue catalog — there are no saved connections to list', async () => {
    const nodes = await createTradingResourceProvider(stub()).listChildren('u1', null)
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every((n) => n.uri.startsWith('localix://resource/trade/'))).toBe(true)
  })

  test('a venue drills straight to its markets — no account folders in between', async () => {
    const provider = createTradingResourceProvider(stub())
    const children = await provider.listChildren('u1', 'localix://resource/trade/public:binance')
    // Market-type folders and/or markets, never a Positions/Balance/Orders level.
    expect(children.some((n) => /positions|balance|orders|history/i.test(n.label))).toBe(false)
  })

  test('a market lists only PUBLIC leaves', async () => {
    const provider = createTradingResourceProvider(stub())
    const leaves = await provider.listChildren(
      'u1',
      `localix://resource/trade/public:binance/markets/${encodeURIComponent(MARKET.symbol)}`,
    )
    const labels = leaves.map((n) => n.label)
    expect(labels).toContain('ticker')
    expect(labels).toContain('candles')
    expect(labels).not.toContain('fills')
  })

  test('an expansion answers with markdown, and a failing read says so', async () => {
    const ok = await createTradingResourceProvider(stub()).expand(
      'u1',
      `localix://resource/trade/public:binance/markets/${encodeURIComponent(MARKET.symbol)}/ticker`,
    )
    expect(ok.ok).toBe(true)

    const failed = await createTradingResourceProvider(
      stub({
        ticker: async () => {
          throw new Error('venue down')
        },
      }),
    ).expand(
      'u1',
      `localix://resource/trade/public:binance/markets/${encodeURIComponent(MARKET.symbol)}/ticker`,
    )
    expect(failed.ok).toBe(false)
  })

  test('a timeframe-refined candles URI reaches the provider read unchanged', async () => {
    const calls: string[] = []
    const provider = createTradingResourceProvider(
      stub({
        ohlcv: async (_userId, _connectionId, _symbol, timeframe) => {
          calls.push(timeframe)
          return [
            {
              time: 1,
              open: 1,
              high: 2,
              low: 1,
              close: 2,
              volume: 3,
            },
          ]
        },
      }),
    )
    const result = await provider.expand(
      'u1',
      `localix://resource/trade/public:binance/markets/${encodeURIComponent(MARKET.symbol)}/candles/4h`,
    )
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['4h'])
    if (result.ok) expect(result.content).toContain('4h candles')
  })

  test('a non-trade uri is refused', async () => {
    const provider = createTradingResourceProvider(stub())
    expect((await provider.expand('u1', 'localix://resource/db/x')).ok).toBe(false)
  })
})
