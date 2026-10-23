import { describe, expect, it } from 'bun:test'
import { formatApproxCount } from './formatApproxCount'

describe('formatApproxCount', () => {
  it('shows exact integers under 1,000', () => {
    expect(formatApproxCount(0)).toBe('0')
    expect(formatApproxCount(1)).toBe('1')
    expect(formatApproxCount(950)).toBe('950')
    expect(formatApproxCount(999)).toBe('999')
  })

  it('abbreviates thousands with a tilde and one decimal', () => {
    expect(formatApproxCount(1000)).toBe('~1k')
    expect(formatApproxCount(1234)).toBe('~1.2k')
    expect(formatApproxCount(12345)).toBe('~12.3k')
    expect(formatApproxCount(123456)).toBe('~123k')
  })

  it('abbreviates millions and billions', () => {
    expect(formatApproxCount(3_400_000)).toBe('~3.4M')
    expect(formatApproxCount(1_000_000)).toBe('~1M')
    expect(formatApproxCount(2_100_000_000)).toBe('~2.1B')
  })

  it('rounds a fractional estimate (postgres reltuples is a float cast to bigint upstream)', () => {
    expect(formatApproxCount(42.7)).toBe('43')
  })

  it('renders non-finite / negative defensively without throwing', () => {
    expect(formatApproxCount(Number.NaN)).toBe('NaN')
    expect(formatApproxCount(-1)).toBe('-1')
  })
})
