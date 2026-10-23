import { describe, expect, test } from 'bun:test'
import { formatCountdown } from './time-format'

describe('formatCountdown', () => {
  test('hours + zero-padded minutes when an hour or more remains', () => {
    expect(formatCountdown(3600_000 + 7 * 60_000)).toBe('1h 07m')
    expect(formatCountdown(2 * 3600_000 + 13 * 60_000 + 40_000)).toBe('2h 13m')
  })

  test('minutes + zero-padded seconds under an hour', () => {
    expect(formatCountdown(7 * 60_000 + 12_000)).toBe('7m 12s')
  })

  test('seconds only under a minute', () => {
    expect(formatCountdown(12_000)).toBe('12s')
  })

  test('null when the time is unknown or already past — never a stale "in 0s"', () => {
    expect(formatCountdown(0)).toBeNull()
    expect(formatCountdown(-5000)).toBeNull()
    expect(formatCountdown(Number.NaN)).toBeNull()
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
