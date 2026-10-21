import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { activitySessionGroups, DEFAULT_SESSION_GROUPING_MODE } from './sessionGrouping'

const session = (id: string, updatedAt: number) => ({ id, updatedAt }) as UiSession

describe('activitySessionGroups', () => {
  test('activity is the default grouping mode', () => {
    expect(DEFAULT_SESSION_GROUPING_MODE).toBe('activity')
  })

  test('uses local calendar boundaries and omits empty groups', () => {
    const now = new Date(2026, 8, 21, 15).getTime()
    const today = new Date(2026, 8, 21).getTime()
    const groups = activitySessionGroups(
      [
        session('current', today + 1),
        session('yesterday', today - 1),
        session('last-week', today - 3 * 24 * 60 * 60 * 1000),
        session('old', today - 60 * 24 * 60 * 60 * 1000),
      ],
      now,
    )

    expect(groups.map((group) => [group.label, group.sessions.map((item) => item.id)])).toEqual([
      ['Today', ['current']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['last-week']],
      ['Older', ['old']],
    ])
  })

  test('preserves the incoming sort order inside a bucket', () => {
    const now = new Date(2026, 8, 21, 15).getTime()
    const today = new Date(2026, 8, 21).getTime()
    const groups = activitySessionGroups(
      [session('pinned-old', today + 1), session('newer', today + 2)],
      now,
    )

    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(['pinned-old', 'newer'])
  })
})
