import { describe, expect, test } from 'bun:test'

import { reconnectDelayMs } from './state'

// Pins the reconnect schedule the socket had before it moved onto the shared `backoffMs`.
describe('reconnectDelayMs', () => {
  test('1s, doubling, capped at 8s', () => {
    expect([0, 1, 2, 3, 4, 30].map(reconnectDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ])
  })
})
