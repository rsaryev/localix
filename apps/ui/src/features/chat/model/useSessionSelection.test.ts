import { describe, expect, it } from 'bun:test'
import { applySelect, rangeIds, stepId, type SelectionState } from './useSessionSelection'

const order = ['a', 'b', 'c', 'd', 'e']
const empty: SelectionState = { selected: new Set(), anchorId: null }

describe('rangeIds', () => {
  it('returns the inclusive span between anchor and target', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('is direction-agnostic (anchor after target)', () => {
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('falls back to just the target when there is no anchor', () => {
    expect(rangeIds(order, null, 'c')).toEqual(['c'])
  })

  it('falls back to the target when the anchor is no longer in the list', () => {
    expect(rangeIds(order, 'z', 'c')).toEqual(['c'])
  })

  it('returns nothing when the target is absent', () => {
    expect(rangeIds(order, 'a', 'z')).toEqual([])
  })
})

describe('stepId', () => {
  it('steps forward and backward over the visual order', () => {
    expect(stepId(order, 'b', 1)).toBe('c')
    expect(stepId(order, 'b', -1)).toBe('a')
  })

  it('returns null at the ends', () => {
    expect(stepId(order, 'a', -1)).toBeNull()
    expect(stepId(order, 'e', 1)).toBeNull()
  })

  it('returns null when the row is not in the order', () => {
    expect(stepId(order, 'z', 1)).toBeNull()
  })

  it('composes with applySelect to grow a span like Shift+Arrow', () => {
    // Seed the anchor on the current row, then extend to its neighbour.
    const seeded = applySelect(empty, 'b', {}, order)
    const next = stepId(order, 'b', 1)!
    const grown = applySelect(seeded, next, { range: true }, order)
    expect([...grown.selected]).toEqual(['b', 'c'])
    expect(grown.anchorId).toBe('b')
  })
})

describe('applySelect', () => {
  it('plain pick selects one and anchors on it', () => {
    const next = applySelect(empty, 'c', {}, order)
    expect([...next.selected]).toEqual(['c'])
    expect(next.anchorId).toBe('c')
  })

  it('toggle adds a row and re-anchors', () => {
    const first = applySelect(empty, 'b', { toggle: true }, order)
    const second = applySelect(first, 'd', { toggle: true }, order)
    expect([...second.selected].sort()).toEqual(['b', 'd'])
    expect(second.anchorId).toBe('d')
  })

  it('toggle removes an already-selected row', () => {
    const withB = applySelect(empty, 'b', { toggle: true }, order)
    const withoutB = applySelect(withB, 'b', { toggle: true }, order)
    expect(withoutB.selected.size).toBe(0)
  })

  it('range replaces the selection with the span and keeps the anchor', () => {
    const anchored = applySelect(empty, 'b', { toggle: true }, order)
    const ranged = applySelect(anchored, 'd', { range: true }, order)
    expect([...ranged.selected]).toEqual(['b', 'c', 'd'])
    expect(ranged.anchorId).toBe('b')
  })

  it('range with no prior anchor selects just the target and anchors it', () => {
    const ranged = applySelect(empty, 'c', { range: true }, order)
    expect([...ranged.selected]).toEqual(['c'])
    expect(ranged.anchorId).toBe('c')
  })
})
