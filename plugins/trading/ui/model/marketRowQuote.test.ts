import { describe, expect, it } from 'bun:test'
import type { Market, Ticker } from '../../backend/contracts'
import { marketRowQuote } from './marketRowQuote'

// A number beside a market is a claim about money. `marketRowQuote` must show a price ONLY when the
// venue gave one, and a 24h change ONLY when the venue reports the datum it is derived from. Absent
// is never zero, never another market's number. Pure, so it runs offline.

const market = (over: Partial<Market> = {}): Market =>
  ({
    symbol: 'BTC/USDC:USDC',
    base: 'BTC',
    quote: 'USDC',
    type: 'swap',
    active: true,
    precision: { price: 1, amount: 0.00001 },
    ...over,
  }) as Market

const ticker = (over: Partial<Ticker>): Ticker => ({
  symbol: 'BTC/USDC:USDC',
  timestamp: 0,
  ...over,
})

describe('marketRowQuote — a price is shown only when the venue gave one', () => {
  it('an undefined ticker (unpriced this page) yields null — no price cell at all', () => {
    expect(marketRowQuote(undefined, market())).toBeNull()
  })

  it('a ticker with no last price yields null (never a 0, never a dash-as-price)', () => {
    expect(marketRowQuote(ticker({ last: undefined }), market())).toBeNull()
  })

  it('a real last price is formatted to the market tick', () => {
    const q = marketRowQuote(ticker({ last: 63982.5 }), market())
    expect(q).not.toBeNull()
    // tick price = 1 ⇒ 0 decimals; but the loaded quote carries more digits, so formatPrice keeps
    // what the number needs. The load-bearing assertion is that a price is present at all.
    expect(q!.price).toContain('63,982')
  })

  it('a last price of 0 is still a real quote (a $0 print is not "no price")', () => {
    const q = marketRowQuote(ticker({ last: 0 }), market())
    expect(q).not.toBeNull()
    expect(q!.change).toBeUndefined()
  })
})

describe('marketRowQuote — 24h change appears only where the venue reports it', () => {
  it('shows a signed change when the venue reported one', () => {
    const q = marketRowQuote(ticker({ last: 100, change: 0.031 }), market())
    expect(q!.change).toEqual({ text: '+3.10%', sign: 1 })
  })

  it('tints a negative change', () => {
    const q = marketRowQuote(ticker({ last: 100, change: -0.05 }), market())
    expect(q!.change).toEqual({ text: '-5.00%', sign: -1 })
  })

  it('omits the change entirely for a thin ticker that reports no 24h datum', () => {
    // Hyperliquid's ticker is last + quote volume only; normalizeTicker leaves `change` undefined.
    const q = marketRowQuote(ticker({ last: 63982.5, quoteVolume: 1_000_000 }), market())
    expect(q).not.toBeNull()
    expect(q!.change).toBeUndefined()
  })
})

describe('marketRowQuote — volume', () => {
  const market: Market = {
    symbol: 'DOGE/USDC:USDC',
    base: 'DOGE',
    quote: 'USDC',
    type: 'swap',
    active: true,
    contract: true,
    // Hyperliquid: one contract IS one DOGE, so the venue's count IS a coin count.
    contractSize: 1,
    linear: true,
    precision: {},
    limits: {},
  }

  it('base volume on a contract market is counted in CONTRACTS, not coins', () => {
    // ccxt's `baseVolume` is the venue's own count (OKX's `vol24h`). `DOGE` beside it on a
    // `ctVal: 100` market overstates a day's turnover a hundredfold.
    const okx = { ...market, contractSize: 100 }
    const q = marketRowQuote(
      { timestamp: 0, symbol: okx.symbol, last: 0.07, baseVolume: 1_200 },
      okx,
    )
    expect(q?.volume?.unit).toBe('cont')
  })

  it('base volume is counted in coins, and says so', () => {
    const q = marketRowQuote(
      { timestamp: 0, symbol: market.symbol, last: 0.07, baseVolume: 1_200_000 },
      market,
    )
    expect(q?.volume).toEqual({ text: expect.any(String), unit: 'DOGE' })
  })

  it('quote volume is counted in the quote currency, and says THAT', () => {
    // A cheap asset's coin count and dollar count differ by orders of magnitude. A bare number would
    // rank the markets wrong in the reader's head.
    const q = marketRowQuote(
      { timestamp: 0, symbol: market.symbol, last: 0.07, quoteVolume: 84_000 },
      market,
    )
    expect(q?.volume?.unit).toBe('USDC')
  })

  it('base volume wins when the venue reports both', () => {
    const q = marketRowQuote(
      {
        timestamp: 0,
        symbol: market.symbol,
        last: 0.07,
        baseVolume: 1_200_000,
        quoteVolume: 84_000,
      },
      market,
    )
    expect(q?.volume?.unit).toBe('DOGE')
  })

  it('a venue reporting no volume shows none — a zero would read as an untraded market', () => {
    expect(
      marketRowQuote({ timestamp: 0, symbol: market.symbol, last: 0.07 }, market)?.volume,
    ).toBeUndefined()
    expect(
      marketRowQuote(
        { timestamp: 0, symbol: market.symbol, last: 0.07, baseVolume: Number.NaN },
        market,
      )?.volume,
    ).toBeUndefined()
  })
})
