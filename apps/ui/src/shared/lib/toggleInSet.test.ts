import { describe, expect, test } from 'bun:test'
import { toggleInSet } from './toggleInSet'

describe('toggleInSet', () => {
  test('adds a value that is absent', () => {
    expect([...toggleInSet(new Set(['a']), 'b')].sort()).toEqual(['a', 'b'])
  })

  test('removes a value that is present', () => {
    expect([...toggleInSet(new Set(['a', 'b']), 'a')]).toEqual(['b'])
  })

  test('returns a NEW set, leaving the input untouched', () => {
    const input = new Set(['a'])
    const out = toggleInSet(input, 'b')
    expect(out).not.toBe(input)
    expect([...input]).toEqual(['a']) // original unchanged
  })

  test('round-trips: toggling the same value twice restores the set', () => {
    const start = new Set(['x', 'y'])
    const once = toggleInSet(start, 'z')
    expect([...toggleInSet(once, 'z')].sort()).toEqual(['x', 'y'])
  })

  test('works with non-string members', () => {
    expect([...toggleInSet(new Set<number>([1, 2]), 3)].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})
