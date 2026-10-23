import { expect, test } from 'bun:test'
import type { CcxtExchange } from './ccxt-exchange'
import { hip3Scope, planScopedTickerReads, readScopedTickersRaw } from './ccxt-scoped-reads'

test('the page budget chooses the largest bucket and reports the rest in ranked order', () => {
  const ex = {
    markets: {
      A: { type: 'spot' },
      B: { type: 'spot' },
      S: { type: 'swap' },
      D: { type: 'swap', info: { hip3: true, dex: 'xyz' } },
    },
  }
  const symbols = ['S', 'D', 'A', 'missing', 'B']
  expect(planScopedTickerReads(ex, symbols, 1)).toEqual({
    reads: [{ key: 'type:spot', kind: 'type', scope: 'spot', symbols: ['A', 'B'] }],
    dropped: ['missing', 'D', 'S'],
  })
  expect(symbols).toEqual(['S', 'D', 'A', 'missing', 'B'])
})

test('builder scope prefers the stated dex and refuses an unflagged or malformed name', () => {
  const ex: Pick<CcxtExchange, 'markets'> = {
    markets: {
      stated: { info: { hip3: true, dex: 'actual', name: 'other:token' } },
      fallback: { info: { hip3: true, name: 'xyz:token' } },
      unflagged: { info: { name: 'xyz:token' } },
      malformed: { info: { hip3: true, name: 'xyz:' } },
    },
  }
  expect(hip3Scope(ex as CcxtExchange, 'stated')).toEqual({ dex: 'actual' })
  expect(hip3Scope(ex as CcxtExchange, 'fallback')).toEqual({ dex: 'xyz' })
  expect(hip3Scope(ex as CcxtExchange, 'unflagged')).toBeNull()
  expect(hip3Scope(ex as CcxtExchange, 'malformed')).toBeNull()
})

test('a failed builder bucket leaves its symbols unpriced and still reads the next scope', async () => {
  const calls: unknown[] = []
  const ticker = { symbol: 'spot', last: 42 }
  const ex: Parameters<typeof readScopedTickersRaw>[0] = {
    markets: {
      D1: { info: { hip3: true, dex: 'xyz' } },
      D2: { info: { hip3: true, dex: 'xyz' } },
      spot: { type: 'spot' },
    },
    fetchSwapMarkets: async (params) => {
      calls.push(['dex', params])
      throw new Error('Fixture scope unavailable')
    },
    fetchTickers: async (symbols, params) => {
      calls.push(['type', symbols, params])
      return { spot: ticker }
    },
    parseTicker: () => {
      throw new Error('Failed bucket must not parse')
    },
  }
  const result = await readScopedTickersRaw(ex, ['D1', 'spot', 'D2'])
  expect(calls).toEqual([
    ['dex', { dex: 'xyz' }],
    ['type', ['spot'], { type: 'spot' }],
  ])
  expect(result).toEqual({ spot: ticker })
  expect(result.spot).toBe(ticker)
})
