import { describe, expect, test } from 'bun:test'

import { levenshtein } from './edit-distance'

describe('levenshtein (bounded)', () => {
  test('exact distances within the bound', () => {
    expect(levenshtein('commit', 'commit', 4)).toBe(0)
    expect(levenshtein('cat', 'bat', 2)).toBe(1)
    expect(levenshtein('cat', 'cats', 2)).toBe(1)
    expect(levenshtein('kitten', 'sitting', 3)).toBe(3)
  })

  test('anything past the bound reads as past it, never as a match', () => {
    expect(levenshtein('a', 'abcdef', 2)).toBe(3) // length gap alone
    expect(levenshtein('abc', 'xyz', 2)).toBe(3) // a whole row past the bound
    // The manifest copy built the full matrix and returned 6 here, despite its "capped at 3".
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBeGreaterThan(2)
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBeLessThanOrEqual(3)
  })
})
