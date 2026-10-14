import { describe, expect, test } from 'bun:test'
import {
  MARKET_LEAVES,
  MARKET_TYPE_TOKENS,
  TRADE_CATEGORIES,
  buildTradeUri,
  parseTradeUri,
  type TradeUriNode,
} from './uri'
import { marketTypeSchema } from './contracts'

describe('localix://resource/trade/ uri grammar', () => {
  test('exports the category + leaf token sets', () => {
    // One category, because there is no account half to fold under a venue.
    expect(TRADE_CATEGORIES).toEqual(['markets'])
    expect(MARKET_LEAVES).toEqual([
      'ticker',
      'candles',
      'orderbook',
      'trades',
      'funding',
      'technicals',
    ])
  })

  // uri.ts stays import-free so the UI can bundle it; this pins its copy of the market-type
  // vocabulary to the contracts schema so the two cannot drift.
  test('MARKET_TYPE_TOKENS mirrors marketTypeSchema', () => {
    expect([...MARKET_TYPE_TOKENS]).toEqual([...marketTypeSchema.options])
  })

  test('a lowercase type token in the symbol position is a TYPE folder (round-trips)', () => {
    for (const marketType of MARKET_TYPE_TOKENS) {
      const node: TradeUriNode = {
        kind: 'marketType',
        connectionId: 'public:hyperliquid',
        marketType,
      }
      const uri = buildTradeUri(node)
      expect(uri).toBe(`localix://resource/trade/public%3Ahyperliquid/markets/${marketType}`)
      expect(parseTradeUri(uri)).toEqual(node)
    }
    // A real symbol (always contains an encoded `/`) still parses as a market.
    expect(parseTradeUri('localix://resource/trade/c1/markets/SPOT%2FUSDT')).toEqual({
      kind: 'market',
      connectionId: 'c1',
      symbol: 'SPOT/USDT',
    })
  })

  test('builds the canonical URIs', () => {
    expect(buildTradeUri({ kind: 'connection', connectionId: 'c1' })).toBe(
      'localix://resource/trade/c1',
    )
    expect(buildTradeUri({ kind: 'markets', connectionId: 'c1' })).toBe(
      'localix://resource/trade/c1/markets',
    )
  })

  test('encodes a symbol containing / and : into ONE segment (round-trips)', () => {
    const symbol = 'BTC/USDC:USDC'
    const market: TradeUriNode = { kind: 'market', connectionId: 'c1', symbol }
    const uri = buildTradeUri(market)
    // The / and : must be escaped so the whole symbol is a single path segment.
    expect(uri).toBe('localix://resource/trade/c1/markets/BTC%2FUSDC%3AUSDC')
    expect(uri.slice('localix://resource/trade/c1/markets/'.length)).not.toContain('/')
    expect(parseTradeUri(uri)).toEqual(market)

    const leaf: TradeUriNode = { kind: 'marketLeaf', connectionId: 'c1', symbol, leaf: 'candles' }
    const leafUri = buildTradeUri(leaf)
    expect(leafUri).toBe('localix://resource/trade/c1/markets/BTC%2FUSDC%3AUSDC/candles')
    expect(parseTradeUri(leafUri)).toEqual(leaf)
  })

  test('candles and technicals round-trip an exact live-view timeframe refinement', () => {
    for (const leaf of ['candles', 'technicals'] as const) {
      const node: TradeUriNode = {
        kind: 'marketLeaf',
        connectionId: 'c1',
        symbol: 'BTC/USDC:USDC',
        leaf,
        timeframe: '4h',
      }
      const uri = buildTradeUri(node)
      expect(uri).toBe(`localix://resource/trade/c1/markets/BTC%2FUSDC%3AUSDC/${leaf}/4h`)
      expect(parseTradeUri(uri)).toEqual(node)
    }
  })

  test('rejects malformed or unsupported live-view refinements', () => {
    expect(parseTradeUri('localix://resource/trade/c1/markets/BTC%2FUSDT/ticker/4h')).toBeNull()
    expect(
      parseTradeUri('localix://resource/trade/c1/markets/BTC%2FUSDT/candles/hourly'),
    ).toBeNull()
    expect(parseTradeUri('localix://resource/trade/c1/markets/BTC%2FUSDT/candles/')).toBeNull()
  })

  test('a crafted `..` segment returns null', () => {
    expect(parseTradeUri('localix://resource/trade/c1/..')).toBeNull()
    expect(parseTradeUri('localix://resource/trade/c1/../markets')).toBeNull()
    expect(parseTradeUri('localix://resource/trade/c1/markets/../orders')).toBeNull()
  })

  test('an unknown category / leaf returns null', () => {
    expect(parseTradeUri('localix://resource/trade/c1/wallets')).toBeNull()
    expect(parseTradeUri('localix://resource/trade/c1/markets/BTC%2FUSDT/depth')).toBeNull()
  })

  test('a wrong provider / missing connection returns null', () => {
    expect(parseTradeUri('localix://resource/db/c1')).toBeNull()
    expect(parseTradeUri('localix://resource/trade/')).toBeNull()
    expect(parseTradeUri('not-a-uri')).toBeNull()
  })

  // `fills` is the one token that is BOTH a market leaf and an account category. The parser
  // derives its sets from those arrays, so the two scopes cannot drift from the builder.
})
