import { describe, it, expect } from 'bun:test'
import { inclusiveFrom, inclusiveTo } from './usage-query-helpers'

// Guards the iter12 fix: usage_events.created_at is SQLite CURRENT_TIMESTAMP
// ('YYYY-MM-DD HH:MM:SS'). A bare-date upper bound string-compares BELOW every
// timestamp on that day, so `created_at <= to` would silently drop the end day.
describe('inclusiveTo — usage date-range upper bound', () => {
  it('expands a bare date to end-of-day (so the whole day is included)', () => {
    expect(inclusiveTo('2026-06-14')).toBe('2026-06-14 23:59:59')
  })

  it('leaves a full space-format timestamp untouched', () => {
    expect(inclusiveTo('2026-06-14 03:05:30')).toBe('2026-06-14 03:05:30')
  })

  it('leaves an ISO timestamp untouched (no bare-date match)', () => {
    expect(inclusiveTo('2026-06-14T03:05:30.000Z')).toBe('2026-06-14T03:05:30.000Z')
  })

  it('only matches a strict YYYY-MM-DD shape', () => {
    expect(inclusiveTo('2026-6-1')).toBe('2026-6-1') // not zero-padded → untouched
    expect(inclusiveTo('garbage')).toBe('garbage')
  })
})

// Guards the LOWER-bound direction: the UI sends `from` as ISO; its 'T' sorts ABOVE
// the space in same-day rows, so a raw `created_at >= from` dropped same-day rows.
describe('inclusiveFrom — usage date-range lower bound', () => {
  it('normalizes an ISO from to space-format (so same-day rows are kept)', () => {
    expect(inclusiveFrom('2026-06-13T12:00:00.000Z')).toBe('2026-06-13 12:00:00')
  })

  it('folds a timezone offset to the UTC column format', () => {
    // 2026-06-13T14:00:00+02:00 === 12:00:00Z
    expect(inclusiveFrom('2026-06-13T14:00:00+02:00')).toBe('2026-06-13 12:00:00')
  })

  it('passes a bare date or space-format value through (they compare fine)', () => {
    expect(inclusiveFrom('2026-06-13')).toBe('2026-06-13')
    expect(inclusiveFrom('2026-06-13 12:00:00')).toBe('2026-06-13 12:00:00')
  })
})
