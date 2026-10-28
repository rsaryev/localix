import { describe, expect, test } from 'bun:test'
import { describeForAgent, summarize, type Entry } from './model'

// Noon local time, so every day key below is the same in any time zone.
const now = new Date(2026, 9, 28, 12, 0)
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 28 - daysAgo, hour, 0).toISOString()
const entry = (title: string, amount: number, category: string, when: string): Entry => ({
  id: title,
  title,
  amount,
  category,
  note: '',
  at: when,
})

const entries = [
  entry('Oatmeal', 320, 'Breakfast', at(0, 8)),
  entry('Soup', 400, 'Lunch', at(0, 13)),
  entry('Apple', 80, 'Snack', at(0, 16)),
  entry('Pasta', 700, 'Dinner', at(1, 19)),
  entry('Long ago', 999, 'Dinner', at(9)),
]

describe('the summary the screen and the agent share', () => {
  test("counts today against the goal, newest first, and today's categories by size", () => {
    const summary = summarize(entries, now, { dailyGoal: 2000, unit: 'kcal' })

    expect(summary.today).toBe(800)
    expect(summary.progress).toBe(0.4)
    expect(summary.left).toBe(1200)
    expect(summary.todayEntries.map((e) => e.title)).toEqual(['Apple', 'Soup', 'Oatmeal'])
    expect(summary.byCategory).toEqual([
      { key: 'Lunch', value: 400 },
      { key: 'Breakfast', value: 320 },
      { key: 'Snack', value: 80 },
    ])
  })

  test('orders today by the moment, whatever offset each entry was logged with', () => {
    // The later entry is written with a −05:00 offset, so its text sorts before the earlier one's.
    const later = new Date(2026, 9, 28, 9, 0)
    const shifted = new Date(later.getTime() - 5 * 3_600_000).toISOString().replace('Z', '-05:00')
    const summary = summarize(
      [entry('Toast', 200, 'Breakfast', at(0, 8)), entry('Coffee', 5, 'Breakfast', shifted)],
      now,
      { dailyGoal: 2000, unit: 'kcal' },
    )

    expect(summary.todayEntries.map((e) => e.title)).toEqual(['Coffee', 'Toast'])
  })

  test('shows the last seven days, oldest first, today included and empty days as zero', () => {
    const week = summarize(entries, now, { dailyGoal: 2000, unit: 'kcal' }).week

    expect(week).toHaveLength(7)
    expect(week.at(-1)).toEqual({ key: '2026-10-28', value: 800 })
    expect(week.at(-2)).toEqual({ key: '2026-10-27', value: 700 })
    expect(week[0]).toEqual({ key: '2026-10-22', value: 0 })
  })

  test('stops progress at the goal and never shows a negative amount left', () => {
    const over = summarize(entries, now, { dailyGoal: 500, unit: 'kcal' })

    expect(over.progress).toBe(1)
    expect(over.left).toBe(0)
  })

  test('tells the agent the totals and the entries it can act on, by id', () => {
    const text = describeForAgent(summarize(entries, now, { dailyGoal: 2000, unit: 'kcal' }))

    expect(text).toContain('Today: 800 of 2000 kcal (40%), 1200 kcal left.')
    expect(text).toContain('- Apple: 80 kcal, Snack (id Apple)')
    expect(text).toContain('Last 7 days: 1500 kcal in total.')
  })
})
