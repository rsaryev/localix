import { describe, expect, test } from 'bun:test'

import { createChangeSignal } from './change-signal'

describe('a provider change signal', () => {
  test('its own changes and changes heard elsewhere reach a subscriber until it unsubscribes', () => {
    const elsewhere = new Set<() => void>()
    const signal = createChangeSignal((listener) => {
      elsewhere.add(listener)
      return () => elsewhere.delete(listener)
    })
    let heard = 0
    const stop = signal.subscribe(() => heard++)
    signal.changed()
    elsewhere.forEach((listener) => listener())
    stop()
    signal.changed()
    elsewhere.forEach((listener) => listener())
    expect(heard).toBe(2)
  })
})
