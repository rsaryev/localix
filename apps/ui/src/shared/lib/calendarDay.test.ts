import { describe, expect, test } from 'bun:test'
import { dayLabel, localDayStart } from './calendarDay'

const NOW = new Date('2026-09-11T15:00:00')

describe('dayLabel', () => {
  test('the two days a reader thinks of by name get their names', () => {
    expect(dayLabel(new Date('2026-09-11T09:00:00'), NOW)).toBe('Today')
    expect(dayLabel(new Date('2026-09-10T23:59:00'), NOW)).toBe('Yesterday')
  })

  test('"yesterday" is a calendar day, not 24 hours', () => {
    // 10pm yesterday is 17 hours before 3pm today, and still yesterday.
    expect(dayLabel(new Date('2026-09-10T22:00:00'), NOW)).toBe('Yesterday')
    // 1am today is 14 hours before, and is not.
    expect(dayLabel(new Date('2026-09-11T01:00:00'), NOW)).toBe('Today')
  })

  test('this year drops the year; another year keeps it', () => {
    expect(dayLabel(new Date('2026-03-02T10:00:00'), NOW)).not.toContain('2026')
    expect(dayLabel(new Date('2025-12-31T10:00:00'), NOW)).toContain('2025')
  })
})

test('two moments of one local day share a day start, and the next day does not', () => {
  const morning = localDayStart(new Date('2026-09-11T00:05:00'))
  expect(localDayStart(new Date('2026-09-11T23:55:00'))).toBe(morning)
  expect(localDayStart(new Date('2026-09-12T00:05:00'))).not.toBe(morning)
})
