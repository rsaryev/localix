import { describe, expect, test } from 'bun:test'

import { rangeToBucket, rangeToFromIso } from './usageRange'

const NOW = Date.parse('2026-06-13T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('rangeToFromIso', () => {
  test('all-time → undefined (no lower bound)', () => {
    expect(rangeToFromIso('all', NOW)).toBeUndefined()
  })

  test('presets subtract the right number of days from nowMs', () => {
    expect(rangeToFromIso('7d', NOW)).toBe(new Date(NOW - 7 * DAY).toISOString())
    expect(rangeToFromIso('30d', NOW)).toBe(new Date(NOW - 30 * DAY).toISOString())
    expect(rangeToFromIso('90d', NOW)).toBe(new Date(NOW - 90 * DAY).toISOString())
  })

  test('result is a valid ISO string', () => {
    const iso = rangeToFromIso('30d', NOW)!
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
  })
})

describe('rangeToBucket', () => {
  test('hourly only for the 7-day range, daily otherwise', () => {
    expect(rangeToBucket('7d')).toBe('hour')
    expect(rangeToBucket('30d')).toBe('day')
    expect(rangeToBucket('90d')).toBe('day')
    expect(rangeToBucket('all')).toBe('day')
  })
})
