import { describe, expect, test } from 'bun:test'

import { saveRetryDelayMs } from '@/shared/lib/user-settings/settingsStore'

// Pins the save-retry schedule it had before it moved onto the shared `backoffMs`.
describe('saveRetryDelayMs', () => {
  test('1s after the first failure, doubling, capped at 30s', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(saveRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ])
  })
})
