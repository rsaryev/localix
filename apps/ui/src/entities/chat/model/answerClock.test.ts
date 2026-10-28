import { expect, test } from 'bun:test'
import { answerClock } from './answerClock'

test('tracks active runs per session without resetting on a return visit', () => {
  try {
    answerClock.start('a', 1_000)
    answerClock.start('b', 2_000)
    expect(answerClock.startedAt('a')).toBe(1_000)
    expect(answerClock.startedAt('b')).toBe(2_000)

    // The next run replaces the previous start.
    answerClock.start('a', 3_000)
    expect(answerClock.startedAt('a')).toBe(3_000)
    answerClock.end('a')
    expect(answerClock.startedAt('b')).toBe(2_000)
  } finally {
    answerClock.end('a')
    answerClock.end('b')
  }
})
