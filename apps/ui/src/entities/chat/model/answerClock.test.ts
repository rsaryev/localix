import { expect, test } from 'bun:test'
import { answerClock } from './answerClock'

test('tracks active runs per session without resetting on a return visit', () => {
  try {
    answerClock.start('a', 'localix', 1_000)
    answerClock.start('b', 'frontend', 2_000)
    expect(answerClock.startedAt('a', 'localix')).toBe(1_000)
    expect(answerClock.startedAt('b', 'frontend')).toBe(2_000)

    // The next run, even from the same agent, replaces the previous start.
    answerClock.start('a', 'localix', 3_000)
    expect(answerClock.startedAt('a', 'localix')).toBe(3_000)
    answerClock.end('a')
    expect(answerClock.startedAt('b', 'frontend')).toBe(2_000)
  } finally {
    answerClock.end('a')
    answerClock.end('b')
  }
})
