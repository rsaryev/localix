import { describe, expect, test } from 'bun:test'
import {
  loopCadenceLabel,
  loopClockTime,
  loopCountdown,
  loopPreview,
  loopHoldLabel,
  loopLastStatusLabel,
} from './format'

describe('loopCadenceLabel', () => {
  test('fixed crons map to interval labels', () => {
    expect(loopCadenceLabel({ kind: 'fixed', cron: '*/3 * * * *' })).toBe('every 3m')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 */2 * * *' })).toBe('every 2h')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 0 */5 * *' })).toBe('every 5d')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 0 * * *' })).toBe('daily')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 * * * *' })).toBe('hourly')
  })

  test('clock-time crons map to readable phrases', () => {
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 9 * * *' })).toBe('daily at 9:00')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '30 14 * * *' })).toBe('daily at 14:30')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '15 9 * * 1-5' })).toBe('weekdays at 9:15')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 8 * * 1' })).toBe('Mondays at 8:00')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 8 * * 0' })).toBe('Sundays at 8:00')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 8 * * 7' })).toBe('Sundays at 8:00')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 10 * * 0,6' })).toBe('weekends at 10:00')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '7 * * * *' })).toBe('hourly at :07')
  })

  test('an unrecognized cron is echoed verbatim', () => {
    expect(loopCadenceLabel({ kind: 'fixed', cron: '15 9 1 * *' })).toBe('15 9 1 * *')
    expect(loopCadenceLabel({ kind: 'fixed', cron: '0 9,17 * * *' })).toBe('0 9,17 * * *')
    expect(loopCadenceLabel({ kind: 'fixed', cron: null })).toBe('')
  })

  test('dynamic loops show "dynamic", with the heartbeat when known', () => {
    expect(loopCadenceLabel({ kind: 'dynamic', cron: null })).toBe('dynamic')
    expect(loopCadenceLabel({ kind: 'dynamic', cron: null, delaySeconds: 1800 })).toBe(
      'dynamic · ~30m',
    )
  })
})

describe('loopPreview', () => {
  test('maintenance loops show a stable label, not the boilerplate prompt', () => {
    expect(
      loopPreview({
        maintenance: true,
        prompt: 'Scheduled maintenance loop iteration.\n\n- Continue…',
      }),
    ).toBe('Maintenance routine')
  })
  test('task loops show their prompt verbatim', () => {
    expect(loopPreview({ maintenance: false, prompt: 'check the deploy' })).toBe('check the deploy')
  })
})

describe('loopCountdown', () => {
  const now = Date.parse('2026-06-19T12:00:00Z')
  test('null target is idle; past/equal is now', () => {
    expect(loopCountdown(null, now)).toBe('idle')
    expect(loopCountdown('2026-06-19T11:59:00Z', now)).toBe('now')
    expect(loopCountdown('2026-06-19T12:00:00Z', now)).toBe('now')
  })
  test('seconds / minutes / hours buckets', () => {
    expect(loopCountdown('2026-06-19T12:00:30Z', now)).toBe('30s')
    expect(loopCountdown('2026-06-19T12:04:00Z', now)).toBe('4m')
    expect(loopCountdown('2026-06-19T14:00:00Z', now)).toBe('2h')
  })
})

describe('loopHoldLabel', () => {
  const NOW = Date.parse('2026-07-26T12:00:00Z')

  test('names the hold and how long is left', () => {
    // The gap it closes: `lastStatus` reports whether the WAKE was delivered, so after the
    // quota ran out the loop kept reading "ok" while doing nothing for up to an hour, with the
    // countdown still ticking as if occurrences were being spent.
    expect(loopHoldLabel({ heldUntil: '2026-07-26T12:14:00Z' }, NOW)).toBe(
      'held 14m · provider limit',
    )
    expect(loopHoldLabel({ heldUntil: '2026-07-26T12:00:30Z' }, NOW)).toBe(
      'held 30s · provider limit',
    )
  })

  test('an expired or absent hold is not a hold', () => {
    // The field is derived at read time, but a client can hold a snapshot across the moment it
    // lapses — rendering "held 0s" then would be a lie the server never told.
    expect(loopHoldLabel({ heldUntil: '2026-07-26T11:59:00Z' }, NOW)).toBeNull()
    expect(loopHoldLabel({ heldUntil: '2026-07-26T12:00:00Z' }, NOW)).toBeNull()
    expect(loopHoldLabel({ heldUntil: null }, NOW)).toBeNull()
    expect(loopHoldLabel({}, NOW)).toBeNull()
  })

  test('a malformed timestamp reports nothing rather than NaN', () => {
    expect(loopHoldLabel({ heldUntil: 'soon' }, NOW)).toBeNull()
  })
})

describe('loopLastStatusLabel', () => {
  test('a session loop says DELIVERED, because that is all the record knows', () => {
    // The fire enqueues a wake and the engine records the outcome of THAT
    // (`wakeSession(...).then(() => ok)`), so the run's own success never reaches the loop. A bare
    // "ok" told the reader — and the agent, via `cron get` — that the run had gone fine.
    expect(loopLastStatusLabel({ target: 'session', lastStatus: 'ok' })).toBe('delivered')
  })

  test('a subsession loop says COMPLETED, because it really awaited the child', () => {
    expect(loopLastStatusLabel({ target: 'subsession', lastStatus: 'ok' })).toBe('completed')
  })

  test('error and never-fired are unchanged', () => {
    expect(loopLastStatusLabel({ target: 'session', lastStatus: 'error' })).toBe('error')
    expect(loopLastStatusLabel({ target: 'subsession', lastStatus: 'error' })).toBe('error')
    expect(loopLastStatusLabel({ target: 'session', lastStatus: null })).toBe('pending')
  })

  test('an absent target degrades to the session reading, the conservative one', () => {
    // A caller with only a summary shape must not be told "completed" by default.
    expect(loopLastStatusLabel({ lastStatus: 'ok' })).toBe('delivered')
  })
})

describe('loopClockTime', () => {
  test('prints the wall clock the cron was evaluated in, never a bare UTC instant', () => {
    expect(loopClockTime('2026-09-23T06:00:00.000Z', 'Europe/Moscow')).toBe(
      '2026-09-23 09:00 Europe/Moscow (UTC+03:00)',
    )
  })

  test('the offset follows daylight saving across the year', () => {
    expect(loopClockTime('2026-01-15T14:00:00.000Z', 'America/New_York')).toBe(
      '2026-01-15 09:00 America/New_York (UTC-05:00)',
    )
    expect(loopClockTime('2026-07-15T13:00:00.000Z', 'America/New_York')).toBe(
      '2026-07-15 09:00 America/New_York (UTC-04:00)',
    )
  })

  test('a zero offset is spelled out like any other', () => {
    expect(loopClockTime('2026-09-23T00:05:00.000Z', 'UTC')).toBe(
      '2026-09-23 00:05 UTC (UTC+00:00)',
    )
  })
})
