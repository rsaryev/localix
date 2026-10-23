import { describe, expect, test } from 'bun:test'

import {
  frameMatchesStream,
  tradingStreamKey,
  type TradingStreamParams,
} from './tradingStreamClient'

/**
 * Behavior lock for the pure stream-routing helpers. frameMatchesStream decides which live
 * WS frame reaches which chart tab — a regression misroutes market data (one symbol's ticker
 * shown under another, or an ohlcv frame of the wrong timeframe), or drops updates. Pin the
 * channel → symbol → ohlcv-timeframe gating, and tradingStreamKey's stable identity (it must
 * mirror the backend key so refcounting shares one server subscribe).
 */
const params = (over: Partial<TradingStreamParams>): TradingStreamParams => ({
  connectionId: 'c1',
  channel: 'ticker',
  ...over,
})

const dataFrame = (over: { channel?: string; symbol?: string; payload?: unknown }): any => ({
  kind: 'data',
  channel: over.channel ?? 'ticker',
  symbol: over.symbol,
  payload: over.payload ?? { channel: over.channel ?? 'ticker' },
})

describe('tradingStreamKey', () => {
  test('is stable and distinguishes every field', () => {
    const a = tradingStreamKey(params({ symbol: 'BTC/USDT' }))
    expect(tradingStreamKey(params({ symbol: 'BTC/USDT' }))).toBe(a) // same → same
    expect(tradingStreamKey(params({ symbol: 'ETH/USDT' }))).not.toBe(a) // symbol differs
    expect(tradingStreamKey(params({ symbol: 'BTC/USDT', channel: 'ohlcv' }))).not.toBe(a)
  })

  test('absent symbol/timeframe collapse to empty segments (no undefined in the key)', () => {
    expect(tradingStreamKey(params({}))).toBe('c1\nticker\n\n')
  })
})

describe('frameMatchesStream', () => {
  test('a different channel never matches', () => {
    expect(frameMatchesStream(params({ channel: 'ticker' }), dataFrame({ channel: 'ohlcv' }))).toBe(
      false,
    )
  })

  test('a symbol filter must match; an absent filter matches any symbol', () => {
    expect(
      frameMatchesStream(params({ symbol: 'BTC/USDT' }), dataFrame({ symbol: 'ETH/USDT' })),
    ).toBe(false)
    expect(
      frameMatchesStream(params({ symbol: 'BTC/USDT' }), dataFrame({ symbol: 'BTC/USDT' })),
    ).toBe(true)
    expect(frameMatchesStream(params({ symbol: undefined }), dataFrame({ symbol: 'ANY' }))).toBe(
      true,
    )
  })

  test('ohlcv routes by timeframe when the subscription pins one', () => {
    const p = params({ channel: 'ohlcv', symbol: 'BTC/USDT', timeframe: '1h' })
    expect(
      frameMatchesStream(
        p,
        dataFrame({
          channel: 'ohlcv',
          symbol: 'BTC/USDT',
          payload: { channel: 'ohlcv', timeframe: '1h' },
        }),
      ),
    ).toBe(true)
    expect(
      frameMatchesStream(
        p,
        dataFrame({
          channel: 'ohlcv',
          symbol: 'BTC/USDT',
          payload: { channel: 'ohlcv', timeframe: '5m' },
        }),
      ),
    ).toBe(false)
  })

  test('an ohlcv subscription with no timeframe accepts any timeframe', () => {
    const p = params({ channel: 'ohlcv', symbol: 'BTC/USDT' })
    expect(
      frameMatchesStream(
        p,
        dataFrame({
          channel: 'ohlcv',
          symbol: 'BTC/USDT',
          payload: { channel: 'ohlcv', timeframe: '5m' },
        }),
      ),
    ).toBe(true)
  })
})
