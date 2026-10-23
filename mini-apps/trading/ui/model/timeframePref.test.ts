import { describe, expect, test } from 'bun:test'
import { pickTimeframe } from './timeframePref'

// Hyperliquid's real list, in the order ccxt reports it.
const HL = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M']

describe('pickTimeframe', () => {
  test('honours a remembered timeframe the venue still offers', () => {
    expect(pickTimeframe('5m', HL)).toBe('5m')
    expect(pickTimeframe('1w', HL)).toBe('1w')
  })

  test('a remembered timeframe the venue dropped falls back to the preferred order', () => {
    expect(pickTimeframe('7m', HL)).toBe('1h')
    expect(pickTimeframe('1h', ['15m', '4h'])).toBe('15m')
  })

  test('nothing remembered opens on the first preferred timeframe the venue offers', () => {
    expect(pickTimeframe(null, HL)).toBe('1h')
    expect(pickTimeframe(undefined, ['4h', '1d'])).toBe('4h')
  })

  test('a venue offering none of the preferred timeframes opens on its first', () => {
    expect(pickTimeframe(null, ['6h', '2d'])).toBe('6h')
  })

  test('a venue that reports no timeframes at all falls back to 1h', () => {
    expect(pickTimeframe('5m', [])).toBe('1h')
  })

  test('matching is case-sensitive — 1m is a minute, 1M is a month', () => {
    // The one pair of tokens that differ by case alone. A scalper who saved `1m` must never be
    // handed a monthly chart, and vice versa.
    expect(pickTimeframe('1M', HL)).toBe('1M')
    expect(pickTimeframe('1m', HL)).toBe('1m')
    // A venue offering only minutes must not satisfy a saved month.
    expect(pickTimeframe('1M', ['1m', '5m'], ['5m'])).toBe('5m')
  })
})
