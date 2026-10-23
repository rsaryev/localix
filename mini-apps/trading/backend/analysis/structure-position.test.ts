import { describe, expect, it } from 'bun:test'
import { renderStructurePosition, structurePosition } from './structure-position'
import type { PriceLevel } from './pattern-detect'

const level = (kind: PriceLevel['kind'], price: number): PriceLevel => ({
  kind,
  price,
  touches: 2,
  lastTouch: 0,
})

const levels: PriceLevel[] = [
  level('support', 90),
  level('support', 95),
  level('resistance', 110),
  level('resistance', 120),
]

describe('structurePosition', () => {
  it('brackets the price with the nearest level each side', () => {
    const pos = structurePosition(levels, 100)
    expect(pos.support?.price).toBe(95) // nearest below
    expect(pos.resistance?.price).toBe(110) // nearest above
    expect(pos.supportPct).toBeCloseTo(5, 5) // (100-95)/100
    expect(pos.resistancePct).toBeCloseTo(10, 5) // (110-100)/100
  })

  it('handles price above all levels (no resistance) and below all (no support)', () => {
    const above = structurePosition(levels, 130)
    expect(above.resistance).toBeNull()
    expect(above.support?.price).toBe(120)
    const below = structurePosition(levels, 80)
    expect(below.support).toBeNull()
    expect(below.resistance?.price).toBe(90)
  })

  it('renders distances and the room ratio', () => {
    const text = renderStructurePosition(structurePosition(levels, 100), 100).join('\n')
    expect(text).toContain('above support 95')
    expect(text).toContain('below resistance 110')
    expect(text).toContain('room to resistance vs support ≈ 2:1') // 10% / 5%
  })

  it('renders nothing when there are no levels', () => {
    expect(renderStructurePosition(structurePosition([], 100), 100)).toEqual([])
  })
})
