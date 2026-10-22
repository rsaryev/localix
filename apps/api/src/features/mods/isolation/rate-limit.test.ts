import { expect, test } from 'bun:test'
import { createRateLimit, truncated } from './rate-limit'

test('a window passes its lines, says once that it is full, and a new window passes again', () => {
  let now = 0
  const limit = createRateLimit({ max: 2, windowMs: 1000, now: () => now })
  expect([limit.take(), limit.take(), limit.take(), limit.take()]).toEqual([
    'pass',
    'pass',
    'first-drop',
    'drop',
  ])
  now = 1000
  expect(limit.take()).toBe('pass')
})

test('a long line is cut, saying how much was left out', () => {
  expect(truncated('abcdef', 3)).toBe('abc… (3 more)')
  expect(truncated('abc', 3)).toBe('abc')
})
