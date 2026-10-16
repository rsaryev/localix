import { describe, expect, it } from 'bun:test'

import { asStringArray } from './coerce'

describe('asStringArray', () => {
  it('keeps only string elements', () => {
    expect(asStringArray(['a', 1, 'b', null, true, 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('returns [] for a non-array', () => {
    expect(asStringArray(undefined)).toEqual([])
    expect(asStringArray(null)).toEqual([])
    expect(asStringArray('a')).toEqual([])
    expect(asStringArray({ 0: 'a' })).toEqual([])
  })

  it('returns a fresh array', () => {
    const input = ['a', 'b']
    expect(asStringArray(input)).not.toBe(input)
  })
})
