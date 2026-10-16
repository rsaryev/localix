import { describe, expect, test } from 'bun:test'

import { fireBackoffMs } from './backoff'

// Pins the schedule the trigger engine had before it moved onto the shared `backoffMs`.
describe('fireBackoffMs', () => {
  test('no failure costs nothing; then one minute, doubling, capped at one hour', () => {
    expect([0, 1, 2, 3, 7, 8, 50].map(fireBackoffMs)).toEqual([
      0, 60_000, 120_000, 240_000, 3_600_000, 3_600_000, 3_600_000,
    ])
  })
})
