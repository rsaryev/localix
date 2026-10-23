import { describe, expect, test } from 'bun:test'
import { findLast } from '@localixai/mini-app-sdk/ui/utilities'

describe('findLast', () => {
  test('returns the last matching item', () => {
    expect(findLast([1, 2, 3, 4], (value) => value % 2 === 0)).toBe(4)
  })

  test('passes the original index to the predicate', () => {
    expect(findLast(['a', 'b', 'c'], (_value, index) => index === 1)).toBe('b')
  })

  test('returns undefined when nothing matches', () => {
    expect(findLast([1, 3, 5], (value) => value % 2 === 0)).toBeUndefined()
  })
})
