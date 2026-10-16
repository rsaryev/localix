import { describe, expect, test } from 'bun:test'
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay, shouldClosePty } from './terminalReconnect'

describe('reconnectDelay', () => {
  test('doubles from 250 ms and caps at 4 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([
      250, 500, 1_000, 2_000, 4_000, 4_000, 4_000,
    ])
    expect(MAX_RECONNECT_ATTEMPTS).toBe(6)
  })
})

describe('shouldClosePty', () => {
  const closed = {
    owned: true,
    receiving: false,
    pending: false,
    unaccepted: false,
    departed: false,
    stillListed: false,
  }

  test('closes an owned PTY whose tab is gone', () => {
    expect(shouldClosePty(closed)).toBe(true)
  })

  test('keeps the PTY for any unowned, listed or transferring pane', () => {
    for (const key of ['receiving', 'pending', 'unaccepted', 'departed', 'stillListed'] as const) {
      expect(shouldClosePty({ ...closed, [key]: true })).toBe(false)
    }
    expect(shouldClosePty({ ...closed, owned: false })).toBe(false)
  })
})
