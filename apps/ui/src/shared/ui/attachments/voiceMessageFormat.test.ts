import { describe, expect, test } from 'bun:test'

import { barHeight, formatTime } from './voiceMessageFormat'

describe('formatTime', () => {
  test('formats m:ss with a zero-padded seconds field', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(600)).toBe('10:00')
  })
  test('floors fractional seconds and clamps negatives to zero', () => {
    expect(formatTime(5.9)).toBe('0:05')
    expect(formatTime(-10)).toBe('0:00')
  })
  test('minutes are not capped at 59 (no hours field)', () => {
    expect(formatTime(3661)).toBe('61:01')
  })
})

describe('barHeight', () => {
  test('is deterministic for the same index', () => {
    expect(barHeight(7)).toBe(barHeight(7))
  })
  test('stays within a renderable band for all bars', () => {
    for (let i = 0; i < 28; i++) {
      const h = barHeight(i)
      expect(h).toBeGreaterThanOrEqual(0.25)
      expect(h).toBeLessThanOrEqual(1.1)
    }
  })
})
