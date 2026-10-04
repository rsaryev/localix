import { describe, expect, test } from 'bun:test'

import { foldCase, matchPositions, positionalMatch } from './positions'

const sorted = (set: Set<number> | null | undefined) => (set ? [...set].sort((a, b) => a - b) : set)

describe('positionalMatch', () => {
  test('classifies exact, prefix, substring and subsequence, case-insensitively', () => {
    expect(positionalMatch('Commit', 'commit')?.kind).toBe('exact')
    expect(positionalMatch('com', 'Commit')?.kind).toBe('prefix')
    expect(positionalMatch('mit', 'commit')).toMatchObject({ kind: 'substring', start: 3 })
    expect(positionalMatch('cmt', 'commit')?.kind).toBe('subsequence')
    expect(positionalMatch('xyz', 'commit')).toBeNull()
    expect(positionalMatch('   ', 'commit')).toBeNull()
  })

  // The old highlight was a greedy scan: it lit `co[m]m[it]` for a row the ranker matched as the
  // substring `com[mit]`. The positions must be the ranked match.
  test('lights the substring the ranker matched, not the first greedy subsequence', () => {
    expect(sorted(matchPositions('mit', 'commit'))).toEqual([3, 4, 5])
  })

  test('prefers the tightest subsequence span', () => {
    // Greedy from the first `f` would take f(0) … l(8); the tight window starts at the second `f`.
    expect(sorted(matchPositions('fl', 'feature/fl-x'))).toEqual([8, 9])
    expect(sorted(matchPositions('fl', 'feature/login'))).toEqual([0, 8])
    expect(sorted(matchPositions('qop', 'QuickOpen'))).toEqual([0, 5, 6])
  })

  test('ignores whitespace in the query for the subsequence tier', () => {
    expect(matchPositions('prompt input', 'PromptInput.tsx')?.size).toBe(11)
  })

  // `'İ'.toLowerCase()` is two code units, so positions taken on a whole-string lowercase
  // pointed one character too far for everything after it.
  test('indexes the ORIGINAL text when case folding changes length', () => {
    expect(foldCase('İstanbul').length).toBe('İstanbul'.length)
    expect(sorted(matchPositions('bul', 'İstanbul'))).toEqual([5, 6, 7])
    expect(positionalMatch('istanbul', 'İstanbul')?.kind).toBe('exact')
  })
})
