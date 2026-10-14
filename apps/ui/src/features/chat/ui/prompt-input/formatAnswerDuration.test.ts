import { expect, test } from 'bun:test'
import { formatAnswerDuration } from './formatAnswerDuration'

test('formats the running answer from seconds through hours', () => {
  expect(formatAnswerDuration(0)).toBe('0sec')
  expect(formatAnswerDuration(1999)).toBe('1sec')
  expect(formatAnswerDuration(63_000)).toBe('1m3sec')
  expect(formatAnswerDuration(3_783_000)).toBe('1h3m3sec')
  expect(formatAnswerDuration(-1000)).toBe('0sec')
})
