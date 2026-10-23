import { describe, expect, test } from 'bun:test'

import { formatCost } from './usageFormat'

describe('formatCost', () => {
  test('sub-tenth-of-a-cent collapses to a threshold label', () => {
    expect(formatCost(0)).toBe('< $0.0001')
    expect(formatCost(0.00004)).toBe('< $0.0001')
  })
  test('small amounts show 4 decimals', () => {
    expect(formatCost(0.00005)).toBe('$0.0001')
    expect(formatCost(0.005)).toBe('$0.0050')
  })
  test('amounts >= 1c use the currency formatter (4 fraction digits)', () => {
    expect(formatCost(0.01)).toBe('$0.0100')
    expect(formatCost(1.5)).toBe('$1.5000')
  })
})
