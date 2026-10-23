import { describe, expect, test } from 'bun:test'
import { mapTradingError, toErrorInfo, TradingError } from './errors'

describe('mapTradingError — classifies by ccxt error CLASS NAME', () => {
  test('a known ccxt error class name maps to its code', () => {
    class InsufficientFunds extends Error {}
    const err = mapTradingError(new InsufficientFunds('not enough margin'))
    expect(err.code).toBe('insufficient_funds')
    expect(err.message).toBe('not enough margin')
  })

  test('walks the prototype chain: a venue subclass of a mapped ccxt base still matches', () => {
    class ExchangeError extends Error {}
    class InsufficientFunds extends ExchangeError {}
    // A venue-specific subclass ccxt itself doesn't define, one level deeper still.
    class BinanceInsufficientFunds extends InsufficientFunds {}
    const err = mapTradingError(new BinanceInsufficientFunds('margin too low'))
    expect(err.code).toBe('insufficient_funds')
  })

  test('a subclass NOT in the table still maps through its mapped base', () => {
    class ExchangeError extends Error {}
    class HyperliquidWeirdError extends ExchangeError {} // not itself in BY_NAME
    const err = mapTradingError(new HyperliquidWeirdError('some venue-specific text'))
    expect(err.code).toBe('exchange_error') // falls through to the ExchangeError base mapping
  })

  test('a plain Error (no ccxt class chain) never matches by class name', () => {
    const err = mapTradingError(new Error('totally generic'))
    expect(err.code).toBe('exchange_error') // falls to the string-fallback bucket
  })
})

describe('mapTradingError — string fallbacks for non-ccxt-classed errors', () => {
  test('rate limit phrases', () => {
    expect(mapTradingError(new Error('Too Many Requests')).code).toBe('rate_limit')
    expect(mapTradingError(new Error('HTTP 429')).code).toBe('rate_limit')
    expect(mapTradingError(new Error('rate limit exceeded')).code).toBe('rate_limit')
  })

  test('network phrases', () => {
    expect(mapTradingError(new Error('connect ECONNREFUSED 127.0.0.1:443')).code).toBe(
      'network_error',
    )
    expect(mapTradingError(new Error('getaddrinfo ENOTFOUND api.exchange.com')).code).toBe(
      'network_error',
    )
    expect(mapTradingError(new Error('fetch failed')).code).toBe('network_error')
    expect(mapTradingError(new Error('socket hang up')).code).toBe('network_error')
    expect(mapTradingError(new Error('request timeout')).code).toBe('network_error')
  })

  test('auth phrases', () => {
    expect(mapTradingError(new Error('invalid signature')).code).toBe('auth_failed')
    expect(mapTradingError(new Error('Unauthorized')).code).toBe('auth_failed')
    expect(mapTradingError(new Error('Invalid API key provided')).code).toBe('auth_failed')
  })

  test('insufficient-funds phrase', () => {
    expect(mapTradingError(new Error('insufficient balance for this trade')).code).toBe(
      'insufficient_funds',
    )
  })

  test('bad-symbol phrases', () => {
    expect(mapTradingError(new Error('binance does not have market symbol FOO/BAR')).code).toBe(
      'bad_symbol',
    )
    expect(mapTradingError(new Error('unknown symbol requested')).code).toBe('bad_symbol')
  })

  test('anything unrecognized falls to exchange_error', () => {
    expect(mapTradingError(new Error('the venue exploded')).code).toBe('exchange_error')
    expect(mapTradingError('a bare string throw').code).toBe('exchange_error')
  })
})

describe('mapTradingError — idempotency', () => {
  test('an existing TradingError passes through unchanged (same instance)', () => {
    const original = new TradingError('bad_symbol', 'no such market')
    expect(mapTradingError(original)).toBe(original)
  })
})

describe('toErrorInfo', () => {
  test('omits `detail` when the raw message equals the friendly one (no custom message given)', () => {
    const err = new TradingError('connection_not_found')
    const info = toErrorInfo(err)
    expect(info.code).toBe('connection_not_found')
    expect(info.message).toBe(err.friendly)
    expect(info.detail).toBeUndefined()
  })

  test('carries the raw venue text as `detail` when it differs from the friendly message', () => {
    const err = new TradingError('insufficient_funds', 'venue said: margin call incoming')
    const info = toErrorInfo(err)
    expect(info.message).toBe(err.friendly)
    expect(info.detail).toBe('venue said: margin call incoming')
  })

  // ── An auth failure must never masquerade as a bad order ──────────────────

  test("Hyperliquid's unregistered-wallet refusal is auth_failed, not invalid_order", () => {
    // The EXACT message the live venue returned when submitting with an unregistered key. ccxt
    // raises InvalidOrder for it. An agent told "invalid order" retries with a different size
    // forever; no size will ever work until the credentials are fixed.
    class InvalidOrder extends Error {}
    const err = new InvalidOrder(
      'hyperliquid {"status":"err","response":"User or API Wallet 0x84d4… does not exist."}',
    )
    expect(mapTradingError(err).code).toBe('auth_failed')
  })

  test('a rejected signature is auth_failed whatever class the venue chose', () => {
    class ExchangeError extends Error {}
    expect(mapTradingError(new ExchangeError('Invalid signature for this request')).code).toBe(
      'auth_failed',
    )
    expect(mapTradingError(new ExchangeError('Unauthorized')).code).toBe('auth_failed')
  })

  test('"does not exist" alone is NOT auth — a missing ORDER is order_not_found', () => {
    class OrderNotFound extends Error {}
    expect(mapTradingError(new OrderNotFound('order 123 does not exist')).code).toBe(
      'order_not_found',
    )
  })

  test('a specific typed class wins over wording that merely mentions an account', () => {
    class OrderNotFound extends Error {}
    class InsufficientFunds extends Error {}
    expect(
      mapTradingError(new OrderNotFound('order 9 for account 0xabc does not exist')).code,
    ).toBe('order_not_found')
    expect(
      mapTradingError(new InsufficientFunds('account 0xabc: permission denied, margin too low'))
        .code,
    ).toBe('insufficient_funds')
  })

  test('a genuinely invalid order keeps its own code', () => {
    class InvalidOrder extends Error {}
    expect(mapTradingError(new InvalidOrder('Order must have minimum value of $10')).code).toBe(
      'invalid_order',
    )
  })
})
