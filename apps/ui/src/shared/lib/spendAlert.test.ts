import { afterEach, describe, expect, it } from 'bun:test'
import {
  dismissSpendAlert,
  dismissedSpendLevel,
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
    expect(spendLevel(100, getSpendThreshold())).toBe(0)
    setSpendThreshold(5)
    expect(spendLevel(undefined, getSpendThreshold())).toBe(0)
    expect(spendLevel(4.99, getSpendThreshold())).toBe(0)
  })

  it('counts whole multiples of the budget crossed', () => {
    setSpendThreshold(5)
    expect(spendLevel(5, getSpendThreshold())).toBe(1)
    expect(spendLevel(9, getSpendThreshold())).toBe(1)
    expect(spendLevel(12, getSpendThreshold())).toBe(2)
  })
})

describe('per-session dismissal', () => {
  it('hides the current level but re-shows at a higher multiple', () => {
    setSpendThreshold(5)
    const s = 'sess-1'
    expect(isSpendAlertVisible(1, dismissedSpendLevel(s))).toBe(true)
    dismissSpendAlert(s, 1)
    expect(isSpendAlertVisible(1, dismissedSpendLevel(s))).toBe(false)
    // Spend climbs into the next bracket → visible again.
    expect(isSpendAlertVisible(2, dismissedSpendLevel(s))).toBe(true)
  })

  it('never shows for level 0', () => {
    expect(isSpendAlertVisible(0, dismissedSpendLevel('sess-2'))).toBe(false)
  })

  it('bounds the dismissal map: evicting the oldest un-suppresses it, current stays', () => {
    setSpendThreshold(5)
    // Fill well past the 500-session cap; the earliest ids get evicted.
    for (let i = 0; i < 600; i++) dismissSpendAlert(`bulk-${i}`, 1)
    // The oldest dismissed session was evicted → its strip is visible again.
    expect(isSpendAlertVisible(1, dismissedSpendLevel('bulk-0'))).toBe(true)
    // A recently dismissed session is still suppressed.
    expect(isSpendAlertVisible(1, dismissedSpendLevel('bulk-599'))).toBe(false)
    // Re-dismissing an existing key never evicts it (has-guard), even at the cap.
    dismissSpendAlert('bulk-599', 1)
    expect(isSpendAlertVisible(1, dismissedSpendLevel('bulk-599'))).toBe(false)
  })
})
