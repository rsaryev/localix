import { afterEach, describe, expect, it } from 'bun:test'
import {
  dismissSpendAlert,
  getSpendThreshold,
  isSpendAlertVisible,
  setSpendThreshold,
  spendLevel,
} from './spendAlert'

afterEach(() => setSpendThreshold(0))

describe('spendAlert threshold', () => {
  it('rejects non-positive / non-finite values (alert off)', () => {
    setSpendThreshold(-3)
    expect(getSpendThreshold()).toBe(0)
    setSpendThreshold(Number.NaN)
    expect(getSpendThreshold()).toBe(0)
    setSpendThreshold(2.5)
    expect(getSpendThreshold()).toBe(2.5)
  })
})

describe('spendLevel', () => {
  it('is 0 when the alert is off, cost is missing, or under budget', () => {
    setSpendThreshold(0)
    expect(spendLevel(100)).toBe(0)
    setSpendThreshold(5)
    expect(spendLevel(undefined)).toBe(0)
    expect(spendLevel(4.99)).toBe(0)
  })

  it('counts whole multiples of the budget crossed', () => {
    setSpendThreshold(5)
    expect(spendLevel(5)).toBe(1)
    expect(spendLevel(9)).toBe(1)
    expect(spendLevel(12)).toBe(2)
  })
})

describe('per-session dismissal', () => {
  it('hides the current level but re-shows at a higher multiple', () => {
    setSpendThreshold(5)
    const s = 'sess-1'
    expect(isSpendAlertVisible(s, 1)).toBe(true)
    dismissSpendAlert(s, 1)
    expect(isSpendAlertVisible(s, 1)).toBe(false)
    // Spend climbs into the next bracket → visible again.
    expect(isSpendAlertVisible(s, 2)).toBe(true)
  })

  it('never shows for level 0', () => {
    expect(isSpendAlertVisible('sess-2', 0)).toBe(false)
  })

  it('bounds the dismissal map: evicting the oldest un-suppresses it, current stays', () => {
    setSpendThreshold(5)
    // Fill well past the 500-session cap; the earliest ids get evicted.
    for (let i = 0; i < 600; i++) dismissSpendAlert(`bulk-${i}`, 1)
    // The oldest dismissed session was evicted → its strip is visible again.
    expect(isSpendAlertVisible('bulk-0', 1)).toBe(true)
    // A recently dismissed session is still suppressed.
    expect(isSpendAlertVisible('bulk-599', 1)).toBe(false)
    // Re-dismissing an existing key never evicts it (has-guard), even at the cap.
    dismissSpendAlert('bulk-599', 1)
    expect(isSpendAlertVisible('bulk-599', 1)).toBe(false)
  })
})
