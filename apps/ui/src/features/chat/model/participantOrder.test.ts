import { describe, expect, test } from 'bun:test'

import { floorIsRunning } from './participantOrder'

describe('floorIsRunning', () => {
  test('a round runs while someone speaks or waits', () => {
    expect(floorIsRunning(null)).toBe(false)
    expect(floorIsRunning({ speaking: null, waiting: [] })).toBe(false)
    expect(floorIsRunning({ speaking: 'a', waiting: [] })).toBe(true)
    expect(floorIsRunning({ speaking: null, waiting: ['a'] })).toBe(true)
  })
})
