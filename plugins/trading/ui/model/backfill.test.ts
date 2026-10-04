import { describe, expect, test } from 'bun:test'
import {
  BACKFILL_TRIGGER_BARS,
  backfillRequest,
  prependedBars,
  shiftedRange,
  shouldBackfill,
  timeframeMs,
} from './backfill'

describe('timeframeMs', () => {
  test('parses the units a venue actually offers', () => {
    expect(timeframeMs('1m')).toBe(60_000)
    expect(timeframeMs('15m')).toBe(900_000)
    expect(timeframeMs('4h')).toBe(14_400_000)
    expect(timeframeMs('1d')).toBe(86_400_000)
    expect(timeframeMs('1w')).toBe(604_800_000)
  })

  test('1m is a minute and 1M is a month — never folded together', () => {
    expect(timeframeMs('1M')).toBe(2_592_000_000)
    expect(timeframeMs('1m')).toBe(60_000)
    expect(timeframeMs('1M')).not.toBe(timeframeMs('1m'))
  })

  test('an unparseable or zero timeframe yields null rather than a guessed length', () => {
    expect(timeframeMs('')).toBeNull()
    expect(timeframeMs('1y')).toBeNull()
    expect(timeframeMs('0m')).toBeNull()
    expect(timeframeMs('h')).toBeNull()
  })
})

describe('shouldBackfill', () => {
  test('fires as the viewport nears the oldest bar', () => {
    expect(shouldBackfill(5)).toBe(true)
    expect(shouldBackfill(BACKFILL_TRIGGER_BARS - 1)).toBe(true)
  })

  test('does not fire in the middle of the history', () => {
    expect(shouldBackfill(200)).toBe(false)
  })

  test('fires once the viewport has scrolled PAST the first bar, where `from` goes negative', () => {
    // lightweight-charts keeps counting into negative logical indices; a `>= 0` guard would leave
    // the trader staring at the void it was meant to fill.
    expect(shouldBackfill(-8)).toBe(true)
  })
})

describe('backfillRequest', () => {
  const oldest = 1_700_000_000 // seconds

  test('asks for the window immediately BEFORE the oldest bar we hold', () => {
    const r = backfillRequest(oldest, '1h', 500)!
    expect(r.limit).toBe(500)
    expect(r.since).toBe(oldest * 1000 - 500 * 3_600_000)
    expect(r.until).toBe(oldest * 1000)
  })

  test('the window is CLOSED at both ends — an open `until` makes the venue send everything since', () => {
    // Given only `since`, ccxt asks for [since, now] and discards the excess: ten pages back on 1m,
    // Hyperliquid sent 5179 bars so that 500 could be kept. The upper bound is what makes paging
    // backwards cost the same at page 10 as at page 1.
    const r = backfillRequest(oldest, '1m', 500)!
    expect(r.until - r.since).toBe(500 * 60_000)
  })

  test('the window ends where our data begins — the oldest bar is re-requested, not skipped', () => {
    const r = backfillRequest(oldest, '1m', 10)!
    // since + limit*step lands exactly on the oldest bar we already have.
    expect(r.since + r.limit * 60_000).toBe(oldest * 1000)
  })

  test('an unknown timeframe places no window rather than a wrong one', () => {
    expect(backfillRequest(oldest, '1y', 500)).toBeNull()
  })

  test('a non-positive bar count asks for nothing', () => {
    expect(backfillRequest(oldest, '1h', 0)).toBeNull()
  })

  test('a window that would start before the epoch is refused, not clamped to a lie', () => {
    expect(backfillRequest(60, '1d', 500)).toBeNull()
  })
})

describe('shiftedRange', () => {
  test('prepending N bars moves the viewport by N, so the same bars stay under the pointer', () => {
    expect(shiftedRange({ from: 4, to: 104 }, 500)).toEqual({ from: 504, to: 604 })
  })

  test('a negative from (scrolled past the first bar) shifts the same way', () => {
    expect(shiftedRange({ from: -6, to: 94 }, 500)).toEqual({ from: 494, to: 594 })
  })

  test('adding nothing moves nothing', () => {
    expect(shiftedRange({ from: 1, to: 2 }, 0)).toEqual({ from: 1, to: 2 })
  })
})

// The shift cannot be taken from the fetch's return value: that promise settles before React hands
// the new bars to the chart, and a range set against bars the series does not hold yet is clamped —
// the clamp then survives the redraw and the chart jumps. So the prepend is measured from the series.
describe('prependedBars', () => {
  const bars = (...times: number[]) => times.map((time) => ({ time }))

  test('counts the bars now older than the one that used to be first', () => {
    expect(prependedBars(30, bars(10, 20, 30, 40))).toBe(2)
  })

  test('the first paint prepends nothing', () => {
    expect(prependedBars(null, bars(10, 20))).toBe(0)
  })

  test('an unchanged head prepends nothing — a tail poll must not move the viewport', () => {
    expect(prependedBars(10, bars(10, 20, 30, 40))).toBe(0)
  })

  test('a series whose head is gone (a symbol switch) prepends nothing rather than a wrong count', () => {
    expect(prependedBars(999, bars(10, 20, 30))).toBe(0)
    expect(prependedBars(999, [])).toBe(0)
  })
})
