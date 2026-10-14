import { describe, expect, test } from 'bun:test'

import { normalizeChartPayload, tradingChartTabId } from './openTab'

describe('normalizeChartPayload', () => {
  test('an explicit credentialed payload keeps its connection id', () => {
    expect(
      normalizeChartPayload({
        connectionId: 'conn-abc',
        exchangeId: 'binance',
        credentialed: true,
      }),
    ).toEqual({ connectionId: 'conn-abc', exchangeId: 'binance', credentialed: true })
  })

  test('a credentialed payload without an exchange id stays credentialed with the venue unknown', () => {
    expect(normalizeChartPayload({ connectionId: 'conn-abc', credentialed: true })).toEqual({
      connectionId: 'conn-abc',
      exchangeId: undefined,
      credentialed: true,
    })
  })

  test('a legacy credentialed id WITHOUT the flag migrates onto the public profile', () => {
    // Restored pre-flag tabs: never inherit account context, and the ref-builder gets the
    // SAME public id the render charts — the UX-6 split this helper closes.
    expect(normalizeChartPayload({ connectionId: 'conn-legacy' })).toEqual({
      connectionId: 'public:hyperliquid',
      exchangeId: 'hyperliquid',
      credentialed: false,
    })
  })

  test('a public id with a stray credentialed flag is still public', () => {
    expect(normalizeChartPayload({ connectionId: 'public:kraken', credentialed: true })).toEqual({
      connectionId: 'public:kraken',
      exchangeId: 'kraken',
      credentialed: false,
    })
  })

  test('exchangeId alone resolves to that venue public profile', () => {
    expect(normalizeChartPayload({ exchangeId: 'bybit' })).toEqual({
      connectionId: 'public:bybit',
      exchangeId: 'bybit',
      credentialed: false,
    })
  })

  test('an empty payload falls back to the default public venue', () => {
    expect(normalizeChartPayload(undefined)).toEqual({
      connectionId: 'public:hyperliquid',
      exchangeId: 'hyperliquid',
      credentialed: false,
    })
  })

  test('a public connection id yields its own venue, not the default', () => {
    expect(normalizeChartPayload({ connectionId: 'public:kraken' })).toEqual({
      connectionId: 'public:kraken',
      exchangeId: 'kraken',
      credentialed: false,
    })
  })
})

describe('tradingChartTabId', () => {
  test('one tab per connection+symbol; the symbol is encoded', () => {
    expect(tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')).toBe(
      'trading:chart:public:hyperliquid:BTC%2FUSDC%3AUSDC',
    )
  })
})
