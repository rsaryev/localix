import { describe, expect, test } from 'bun:test'
import { formatTokenPrice, hasKnownTokenPricing } from './modelPricing'

describe('model pricing presentation', () => {
  test('recognizes only finite non-negative input/output prices', () => {
    expect(hasKnownTokenPricing({ input: 1, output: 4 })).toBe(true)
    expect(hasKnownTokenPricing({ input: 0, output: 0 })).toBe(true)
    expect(hasKnownTokenPricing({ input: -1_000_000, output: -1_000_000 })).toBe(false)
    expect(hasKnownTokenPricing({ input: Number.NaN, output: 1 })).toBe(false)
    expect(hasKnownTokenPricing(undefined)).toBe(false)
  })

  test('formats detailed and compact known prices', () => {
    expect(formatTokenPrice(0)).toBe('Free')
    expect(formatTokenPrice(-1_000_000)).toBe('—')
    expect(formatTokenPrice(0.000_001)).toBe('$0.001/B')
    expect(formatTokenPrice(2.5)).toBe('$2.50')
  })
})
