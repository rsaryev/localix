import { describe, expect, test } from 'bun:test'
import { defaultOhlcvSince, timeframeMs } from './timeframes'

describe('timeframeMs', () => {
  test('parses the ccxt vocabulary', () => {
    expect(timeframeMs('1m')).toBe(60_000)
    expect(timeframeMs('15m')).toBe(900_000)
    expect(timeframeMs('4h')).toBe(14_400_000)
    expect(timeframeMs('1d')).toBe(86_400_000)
    expect(timeframeMs('1w')).toBe(604_800_000)
  })

  test('`m` is a minute and `M` is a month — case is load-bearing', () => {
    expect(timeframeMs('1M')).toBe(2_592_000_000)
    expect(timeframeMs('1M')).not.toBe(timeframeMs('1m'))
  })

  test('an unknown shape is null, never a guess', () => {
    expect(timeframeMs('')).toBeNull()
    expect(timeframeMs('1y')).toBeNull()
    expect(timeframeMs('0m')).toBeNull()
    expect(timeframeMs('h')).toBeNull()
  })
})

describe('defaultOhlcvSince', () => {
  const NOW = 1_700_000_000_000

  test('asks for a (limit − 1)-bar trailing window, so the live bar is never cut off the end', () => {
    // A venue answers ASCENDING from `since` capped at `limit`; a full-width window holding
    // `limit` closed bars plus the in-progress one would drop the LIVE bar.
    expect(defaultOhlcvSince('1h', 300, NOW)).toBe(NOW - 299 * 3_600_000)
    expect(defaultOhlcvSince('1m', 2, NOW)).toBe(NOW - 60_000)
  })

  test('an unparseable timeframe or a degenerate limit yields null (caller keeps the since-less call)', () => {
    expect(defaultOhlcvSince('1y', 300, NOW)).toBeNull()
    expect(defaultOhlcvSince('1h', 0, NOW)).toBeNull()
    expect(defaultOhlcvSince('1h', Number.NaN, NOW)).toBeNull()
  })
})
