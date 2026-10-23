import { describe, expect, test } from 'bun:test'
import { buildTradeUri, parseTradeUri } from '../../backend/uri'
import { marketTabLabel, marketTabLeaf } from './tradeRefs'

describe('marketTabLeaf', () => {
  const SYMBOL = 'BTC/USDC:USDC'

  test('every tab builds a uri the grammar parses back to the same market leaf', () => {
    for (const tab of ['book', 'trades'] as const) {
      const leaf = marketTabLeaf(tab)
      const uri = buildTradeUri({ kind: 'marketLeaf', connectionId: 'c1', symbol: SYMBOL, leaf })
      expect(parseTradeUri(uri)).toEqual({
        kind: 'marketLeaf',
        connectionId: 'c1',
        symbol: SYMBOL,
        leaf,
      })
    }
  })

  test('the Order book tab links `orderbook`, not `book`', () => {
    // The UI word and the grammar token differ; an identity cast would build an unparsable uri.
    expect(marketTabLeaf('book')).toBe('orderbook')
  })

  // `trades` is the venue's public tape; `fills` is the account's own executions. Linking the wrong
  // one hands the agent someone else's trades while the user is looking at the tape, or the reverse.
  test('the Trades tab links the venue tape, never the account fills', () => {
    expect(marketTabLeaf('trades')).toBe('trades')
    expect(marketTabLeaf('trades')).not.toBe('fills')
  })

  test('a symbol carrying `/` and `:` survives into ONE uri segment', () => {
    const uri = buildTradeUri({
      kind: 'marketLeaf',
      connectionId: 'c1',
      symbol: SYMBOL,
      leaf: 'orderbook',
    })
    expect(uri).toBe('localix://resource/trade/c1/markets/BTC%2FUSDC%3AUSDC/orderbook')
    expect(parseTradeUri(uri)?.kind).toBe('marketLeaf')
  })

  test('the pill names the market and the leaf', () => {
    expect(marketTabLabel('book', SYMBOL)).toBe('BTC/USDC:USDC order book')
    expect(marketTabLabel('trades', SYMBOL)).toBe('BTC/USDC:USDC trades')
  })
})
