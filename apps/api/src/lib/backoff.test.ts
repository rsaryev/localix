import { describe, expect, test } from 'bun:test'

import { backoffMs } from './backoff'

describe('backoffMs', () => {
  const policy = { baseMs: 1_000, maxMs: 30_000 }

  test('doubles from the base per attempt', () => {
    expect([0, 1, 2, 3, 4].map((n) => backoffMs(n, policy))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ])
  })

  test('caps at maxMs, including an attempt whose power overflows', () => {
    expect(backoffMs(5, policy)).toBe(30_000)
    expect(backoffMs(10_000, policy)).toBe(30_000)
  })

  test('a NaN, infinite or negative attempt is the first attempt, never a NaN delay', () => {
    expect(backoffMs(Number.NaN, policy)).toBe(1_000)
    expect(backoffMs(-3, policy)).toBe(1_000)
    expect(backoffMs(Number.POSITIVE_INFINITY, policy)).toBe(1_000)
  })

  test('honours a custom factor', () => {
    expect(backoffMs(2, { baseMs: 100, maxMs: 10_000, factor: 3 })).toBe(900)
  })

  test('jitter only shortens, within the requested fraction', () => {
    const jittered = { ...policy, jitter: 0.5 }
    expect(backoffMs(2, jittered, () => 0)).toBe(4_000)
    expect(backoffMs(2, jittered, () => 1)).toBe(2_000)
    expect(backoffMs(9, jittered, () => 0.999)).toBeGreaterThanOrEqual(15_000)
    expect(backoffMs(9, jittered, () => 0)).toBe(30_000)
  })

  test('jitter is clamped to [0, 1] so a delay never goes negative', () => {
    expect(backoffMs(0, { ...policy, jitter: 5 }, () => 1)).toBe(0)
    expect(backoffMs(0, { ...policy, jitter: -1 }, () => 1)).toBe(1_000)
  })
})
