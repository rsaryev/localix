import { describe, expect, it } from 'bun:test'
import { renderRoundLevels, roundLevels } from './round-levels'

describe('roundLevels', () => {
  it('brackets a mid-hundreds price at the hundred increment', () => {
    const r = roundLevels(266)!
    expect(r.below).toBe(200)
    expect(r.above).toBe(300)
    expect(r.belowPct).toBeCloseTo((66 / 266) * 100, 5)
    expect(r.abovePct).toBeCloseTo((34 / 266) * 100, 5)
  })

  it('scales to thousands and to sub-dollar prices', () => {
    const big = roundLevels(65_000)!
    expect(big.below).toBe(60_000)
    expect(big.above).toBe(70_000)
    const small = roundLevels(0.42)!
    expect(small.below).toBeCloseTo(0.4, 10)
    expect(small.above).toBeCloseTo(0.5, 10)
  })

  it('steps down when price sits exactly on a round number', () => {
    const r = roundLevels(300)!
    expect(r.below).toBe(200)
    expect(r.above).toBe(300)
  })

  it('returns null for a non-positive price', () => {
    expect(roundLevels(0)).toBeNull()
    expect(roundLevels(-5)).toBeNull()
  })

  it('renders one line with both magnets and their distances', () => {
    const text = renderRoundLevels(roundLevels(266)!).join('\n')
    expect(text).toContain('round-number magnets')
    expect(text).toContain('200')
    expect(text).toContain('300')
  })
})
