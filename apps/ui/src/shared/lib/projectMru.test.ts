import { describe, it, expect } from 'bun:test'
import { orderByMru } from './projectMru'

describe('orderByMru', () => {
  it('puts recently-used ids first, then the rest in original order', () => {
    expect(orderByMru(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('drops MRU ids that are no longer present', () => {
    expect(orderByMru(['a', 'b'], ['x', 'b'])).toEqual(['b', 'a'])
  })

  it('is a no-op ordering when the MRU is empty', () => {
    expect(orderByMru(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })

  it('preserves duplicate-free original order for the non-recent tail', () => {
    expect(orderByMru(['a', 'b', 'c'], ['b'])).toEqual(['b', 'a', 'c'])
  })
})
