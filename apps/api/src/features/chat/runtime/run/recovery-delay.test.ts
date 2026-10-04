import { describe, expect, test } from 'bun:test'

import { transientRetryDelayMs } from './recovery'

/**
 * The schedule moved onto the shared `backoffMs`; this pins the delays it had before, so the move
 * cannot silently retune the retry loop.
 */
describe('transientRetryDelayMs', () => {
  test('without Retry-After: 2s, 4s, 8s, then the 15s cap', () => {
    expect([0, 1, 2, 3, 4].map((n) => transientRetryDelayMs(undefined, n))).toEqual([
      2_000, 4_000, 8_000, 15_000, 15_000,
    ])
  })

  test('Retry-After is honoured but clamped to [2s, 15s]', () => {
    expect(transientRetryDelayMs(5_000, 0)).toBe(5_000)
    expect(transientRetryDelayMs(0, 1)).toBe(2_000)
    expect(transientRetryDelayMs(3_600_000, 0)).toBe(15_000)
  })
})
