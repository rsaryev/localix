import { describe, expect, test } from 'bun:test'
import {
  TICK_DAY,
  TICK_MONTH,
  TICK_TIME,
  TICK_YEAR,
  axisTickLabel,
  crosshairTimeLabel,
  momentLabel,
  tradeTimeLabel,
} from './timeLabels'

// 2024-01-01T00:30:00Z — chosen so the zone changes the DAY, the MONTH and the YEAR, not just the
// hour. A formatter that quietly ignored its zone would still pass an hours-only fixture.
const NEW_YEAR_EVE_UTC = Date.UTC(2024, 0, 1, 0, 30) / 1000

describe('axisTickLabel', () => {
  test('a time tick reads in the requested zone, not in UTC', () => {
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_TIME, 'UTC')).toBe('00:30')
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_TIME, 'Asia/Tokyo')).toBe('09:30')
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_TIME, 'America/New_York')).toBe('19:30')
  })

  test('the zone can move the DAY across the tick, not merely the clock', () => {
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_DAY, 'UTC')).toBe('1 Jan')
    // Still New Year's Eve in New York.
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_DAY, 'America/New_York')).toBe('31 Dec')
  })

  test('and the month, and the year', () => {
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_MONTH, 'UTC')).toBe('Jan')
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_MONTH, 'America/New_York')).toBe('Dec')
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_YEAR, 'UTC')).toBe('2024')
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_YEAR, 'America/New_York')).toBe('2023')
  })

  test('an unknown tick type falls back to the clock rather than throwing at the axis', () => {
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, 99, 'UTC')).toBe('00:30')
  })

  test('the clock is 24-hour — a trading chart never says 7:30 pm', () => {
    expect(axisTickLabel(NEW_YEAR_EVE_UTC, TICK_TIME, 'America/New_York')).not.toContain('pm')
  })
})

describe('crosshairTimeLabel', () => {
  test('carries the date as well as the clock, in the requested zone', () => {
    expect(crosshairTimeLabel(NEW_YEAR_EVE_UTC, 'UTC')).toBe('1 Jan, 00:30')
    expect(crosshairTimeLabel(NEW_YEAR_EVE_UTC, 'America/New_York')).toBe('31 Dec, 19:30')
  })
})

describe('momentLabel', () => {
  test('reads a millisecond timestamp in the requested zone', () => {
    expect(momentLabel(NEW_YEAR_EVE_UTC * 1000, 'UTC')).toBe('1 Jan, 00:30')
    expect(momentLabel(NEW_YEAR_EVE_UTC * 1000, 'Asia/Tokyo')).toBe('1 Jan, 09:30')
  })

  test('the crosshair (seconds) and an account row (milliseconds) name the same moment', () => {
    // One formatter, so a fill in the account strip and the candle it landed on can never disagree.
    expect(crosshairTimeLabel(NEW_YEAR_EVE_UTC, 'UTC')).toBe(
      momentLabel(NEW_YEAR_EVE_UTC * 1000, 'UTC'),
    )
  })
})

describe('tradeTimeLabel', () => {
  test('HH:MM:SS in the viewer zone, seconds included (tape granularity)', () => {
    expect(tradeTimeLabel(NEW_YEAR_EVE_UTC * 1000, 'UTC')).toBe('00:30:00')
    expect(tradeTimeLabel(NEW_YEAR_EVE_UTC * 1000, 'Asia/Tokyo')).toBe('09:30:00')
  })

  test('an unstamped print is UNDATED (—), never a midnight 00:00:00', () => {
    expect(tradeTimeLabel(undefined, 'UTC')).toBe('—')
    expect(tradeTimeLabel(0, 'UTC')).toBe('—')
    expect(tradeTimeLabel(Number.NaN, 'UTC')).toBe('—')
  })
})
