import { describe, expect, test } from 'bun:test'

import {
  normalizeResourceSort,
  sortableByteSize,
  sortableTimestamp,
  sortResources,
} from './resourceSort'

describe('resource list sorting', () => {
  test('normalizes persisted keys and directions independently', () => {
    const fallback = { key: 'name', direction: 'asc' } as const
    expect(
      normalizeResourceSort({ key: 'status', direction: 'desc' }, ['name', 'status'], fallback),
    ).toEqual({ key: 'status', direction: 'desc' })
    expect(
      normalizeResourceSort({ key: 'removed', direction: 'sideways' }, ['name'], fallback),
    ).toEqual(fallback)
  })

  test('sorts immutably, naturally, and keeps equal rows stable', () => {
    const rows = [
      { name: 'pod-10', group: 1 },
      { name: 'pod-2', group: 1 },
      { name: 'pod-1', group: 1 },
    ]
    const sorted = sortResources(rows, { key: 'name', direction: 'asc' }, (row) => row.name)
    expect(sorted.map((row) => row.name)).toEqual(['pod-1', 'pod-2', 'pod-10'])
    expect(rows.map((row) => row.name)).toEqual(['pod-10', 'pod-2', 'pod-1'])
    expect(sortResources(rows, { key: 'group', direction: 'asc' }, (row) => row.group)).toEqual(
      rows,
    )
    expect(
      sortResources(
        [{ value: null }, { value: 2 }, { value: 1 }],
        { key: 'value', direction: 'desc' },
        (row) => row.value,
      ).map((row) => row.value),
    ).toEqual([2, 1, null])
  })

  test('turns sizes and timestamps into sortable values without guessing junk', () => {
    expect(sortableByteSize('1.5 GiB')).toBe(1.5 * 1024 ** 3)
    expect(sortableByteSize('900MB')).toBe(900 * 1000 ** 2)
    expect(sortableByteSize('unknown')).toBeNull()
    expect(sortableTimestamp('2026-07-23T10:00:00Z')).toBe(1784800800000)
    expect(sortableTimestamp('not-a-date')).toBeNull()
  })
})
