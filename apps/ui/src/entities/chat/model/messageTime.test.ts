import { describe, expect, test } from 'bun:test'
import { messageClock } from './messageTime'

describe('messageClock', () => {
  test('is a clock and nothing else', () => {
    // The day is stated once, above the first message of that day. A date on every card is
    // repetition that still leaves the reader working out where one day ends.
    const shown = messageClock('2026-09-10T10:36:00')
    expect(shown).toMatch(/10[:.]36/)
    expect(shown).not.toMatch(/[A-Za-z]{3,}/)
  })

  test('an old message reads the same as a new one', () => {
    expect(messageClock('2026-03-02T10:36:00')).toBe(messageClock('2026-09-10T10:36:00'))
  })

  test('a row with no timestamp asks for no space', () => {
    // Optimistic rows have not round-tripped yet, so they have no createdAt.
    expect(messageClock(undefined)).toBe('')
    expect(messageClock('')).toBe('')
    expect(messageClock('not a date')).toBe('')
  })
})
