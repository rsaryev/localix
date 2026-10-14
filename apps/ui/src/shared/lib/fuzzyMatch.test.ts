import { describe, expect, test } from 'bun:test'
import { fuzzyMatchPositions } from '@localixai/kit/lib'

describe('fuzzyMatchPositions', () => {
  test('contiguous prefix match', () => {
    expect(fuzzyMatchPositions('quick', 'QuickOpen.tsx')).toEqual(new Set([0, 1, 2, 3, 4]))
  })

  test('case-insensitive scattered subsequence', () => {
    // q,o,p subsequence of "QuickOpen"
    expect(fuzzyMatchPositions('qop', 'QuickOpen')).toEqual(new Set([0, 5, 6]))
  })

  test('returns null when query is not a full subsequence', () => {
    expect(fuzzyMatchPositions('zzz', 'QuickOpen')).toBeNull()
    expect(fuzzyMatchPositions('quik z', 'Quick')).toBeNull()
  })

  test('empty / whitespace query yields null (no highlight)', () => {
    expect(fuzzyMatchPositions('', 'anything')).toBeNull()
    expect(fuzzyMatchPositions('   ', 'anything')).toBeNull()
  })

  test('matches the first tightest subsequence', () => {
    // 'aa' in 'banana' → the first two a's at indices 1 and 3
    expect(fuzzyMatchPositions('aa', 'banana')).toEqual(new Set([1, 3]))
  })

  // The tiered pickers rank `mit` against `commit` as the substring com[mit]; the highlight is the
  // same matcher, so it lights those characters rather than a greedy co[m]m[it].
  test('lights a contiguous substring before a scattered subsequence', () => {
    expect(fuzzyMatchPositions('mit', 'commit')).toEqual(new Set([3, 4, 5]))
  })
})
