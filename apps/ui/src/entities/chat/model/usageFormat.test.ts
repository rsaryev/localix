import { describe, expect, test } from 'bun:test'

import { formatCompactTokens, formatCost } from './usageFormat'

describe('formatCompactTokens', () => {
  test('raw below 1000', () => {
    expect(formatCompactTokens(0)).toBe('0')
    expect(formatCompactTokens(999)).toBe('999')
  })
  test('k with one decimal from 1000 up', () => {
    expect(formatCompactTokens(1000)).toBe('1k')
    expect(formatCompactTokens(1500)).toBe('1.5k')
    expect(formatCompactTokens(12_340)).toBe('12.3k')
    expect(formatCompactTokens(999_999)).toBe('1000k') // just under 1m
  })
  test('m with one decimal from 1,000,000 up', () => {
    expect(formatCompactTokens(1_000_000)).toBe('1.0m')
    expect(formatCompactTokens(2_500_000)).toBe('2.5m')
  })
})

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
