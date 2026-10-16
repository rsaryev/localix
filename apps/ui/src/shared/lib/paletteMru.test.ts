import { describe, expect, it } from 'bun:test'
import { promoteMru, PALETTE_MRU_CAP } from './paletteMru'

describe('promoteMru', () => {
  it('adds a new id to the front', () => {
    expect(promoteMru(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an existing id to the front without duplicating', () => {
    expect(promoteMru(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op re-order when the id is already most-recent', () => {
    expect(promoteMru(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('caps the list length, dropping the oldest', () => {
    expect(promoteMru(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })

  it('defaults to PALETTE_MRU_CAP entries', () => {
    const seed = Array.from({ length: PALETTE_MRU_CAP }, (_, i) => `cmd${i}`)
    const next = promoteMru(seed, 'fresh')
    expect(next.length).toBe(PALETTE_MRU_CAP)
    expect(next[0]).toBe('fresh')
    expect(next).not.toContain(`cmd${PALETTE_MRU_CAP - 1}`)
  })

  it('does not mutate the input list', () => {
    const input = ['a', 'b']
    promoteMru(input, 'c')
    expect(input).toEqual(['a', 'b'])
  })
})
