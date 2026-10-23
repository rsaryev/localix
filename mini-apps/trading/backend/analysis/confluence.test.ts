import { describe, expect, it } from 'bun:test'
import {
  buildSourcedLevels,
  detectConfluence,
  renderConfluence,
  type SourcedLevel,
} from './confluence'

describe('detectConfluence', () => {
  const levels: SourcedLevel[] = [
    { price: 100.0, method: 'pivot', label: 'pivot R1' },
    { price: 100.1, method: 'fib', label: 'fib 61.8' }, // agrees with pivot R1 (0.1%)
    { price: 100.05, method: 'round', label: 'round 100' }, // also agrees
    { price: 120, method: 'pivot', label: 'pivot R2' }, // alone
    { price: 90, method: 'fib', label: 'fib 38.2' }, // alone
  ]

  it('keeps only clusters where ≥2 distinct methods agree', () => {
    const zones = detectConfluence(levels, 95)
    expect(zones).toHaveLength(1)
    const z = zones[0]!
    expect(z.sources.sort()).toEqual(['fib 61.8', 'pivot R1', 'round 100'])
    expect(z.price).toBeCloseTo((100 + 100.1 + 100.05) / 3, 5)
    expect(z.distancePct).toBeCloseTo(((z.price - 95) / 95) * 100, 5)
  })

  it('two levels of the SAME method do not count as confluence', () => {
    const same: SourcedLevel[] = [
      { price: 100, method: 'round', label: 'round 100' },
      { price: 100.05, method: 'fib', label: 'fib 50' }, // control: cross-method DOES count
    ]
    expect(detectConfluence(same, 95)).toHaveLength(1)
    const sameMethod: SourcedLevel[] = [
      { price: 100, method: 'fib', label: 'fib 61.8' },
      { price: 100.05, method: 'fib', label: 'fib 78.6' }, // two fib ratios ≠ confluence
    ]
    expect(detectConfluence(sameMethod, 95)).toEqual([])
  })

  it('sorts zones by distance and caps the count', () => {
    const many: SourcedLevel[] = []
    for (const base of [50, 60, 70, 80, 90]) {
      many.push(
        { price: base, method: 'pivot', label: 'pivot' },
        { price: base + 0.01, method: 'fib', label: 'fib' },
      )
    }
    const zones = detectConfluence(many, 88, 0.0015, 2)
    expect(zones).toHaveLength(2)
    expect(Math.abs(zones[0]!.distancePct)).toBeLessThanOrEqual(Math.abs(zones[1]!.distancePct))
  })

  it('renders zones with sources and distance, nothing when empty', () => {
    expect(renderConfluence([])).toEqual([])
    const text = renderConfluence(detectConfluence(levels, 95)).join('\n')
    expect(text).toContain('confluence')
    // Sources in ascending-price order: pivot R1 (100.0), round 100 (100.05), fib 61.8 (100.1).
    expect(text).toContain('pivot R1 + round 100 + fib 61.8')
    // Price 95 is ~5% from the zone at ~100 — not "at" it.
    expect(text).not.toContain('AT a confluence zone NOW')
  })

  it('flags when price is sitting ON a confluence zone', () => {
    // Reference price 100.05 is inside the ~100 cluster → AT it.
    const text = renderConfluence(detectConfluence(levels, 100.05)).join('\n')
    expect(text).toContain('AT a confluence zone NOW')
    expect(text).toContain('decision point')
  })
})

describe('buildSourcedLevels — SMC methods', () => {
  it('emits an FVG midpoint and a structure-break level as distinct methods', () => {
    const sourced = buildSourcedLevels({
      fvgs: [{ direction: 'bullish', top: 105, bottom: 100, mid: 102.5, time: 1, distancePct: 0 }],
      structureBreak: { type: 'BOS', direction: 'bullish', level: 110, brokenAt: 2, swingTime: 1 },
    })
    expect(sourced).toContainEqual({ price: 102.5, method: 'fvg', label: 'FVG demand' })
    expect(sourced).toContainEqual({ price: 110, method: 'structure', label: 'BOS level' })
  })

  it('an FVG midpoint that lands on a pivot forms confluence (distinct methods)', () => {
    const sourced = buildSourcedLevels({
      pivots: { pp: 102.5, r1: 130, r2: 140, s1: 80, s2: 70 },
      fvgs: [{ direction: 'bearish', top: 103, bottom: 102, mid: 102.5, time: 1, distancePct: 0 }],
    })
    const zones = detectConfluence(sourced, 95)
    expect(
      zones.some((z) => z.sources.includes('FVG supply') && z.sources.includes('pivot PP')),
    ).toBe(true)
  })
})
