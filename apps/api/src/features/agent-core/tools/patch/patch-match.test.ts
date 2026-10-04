import { describe, expect, it } from 'bun:test'
import {
  findMatch,
  findUniqueMatch,
  reindentNewLines,
  describeStrategy,
  closestLineHint,
  buildNotFoundHint,
  buildRepairDiagnosis,
  unescapeLiteral,
} from './patch-match'

describe('unescapeLiteral', () => {
  it('unescapes \\n \\t and \\\\ to real characters', () => {
    expect(unescapeLiteral('a\\nb')).toBe('a\nb')
    expect(unescapeLiteral('a\\tb')).toBe('a\tb')
    expect(unescapeLiteral('a\\\\b')).toBe('a\\b')
  })
  it('leaves \\n alone when newlines are excluded', () => {
    expect(unescapeLiteral('a\\nb', false)).toBe('a\\nb')
  })
})

describe('buildRepairDiagnosis', () => {
  it('does not misdiagnose a stale generic declaration as a split file line', () => {
    const lines = [
      'const allSessionIndexCache = new WeakMap<readonly UiSession[], ReadonlyMap<string, number>>()',
    ]
    const requested = [
      'const allSessionIndices = new WeakMap<',
      'readonly UiSession[],',
      'ReadonlyMap<string, number>',
      '>()',
    ]
    const diagnosis = buildRepairDiagnosis(lines, requested)
    expect(diagnosis).not.toContain('one whole file line')
    expect(diagnosis).toContain('closest whole file line differs')
    expect(diagnosis).toContain('allSessionIndexCache')
  })

  it('identifies the first stale line after an exact prefix', () => {
    const diagnosis = buildRepairDiagnosis(
      [
        "import type { UiSession } from '@/shared/api/contracts'",
        'export function findSession() {}',
      ],
      ["import type { UiSession } from '@/shared/api/contracts'", 'export function lookup() {}'],
    )
    expect(diagnosis).toContain('first 1 requested line(s) match at file line 1')
    expect(diagnosis).toContain('findSession')
    expect(diagnosis).toContain('lookup')
  })

  it('only calls fragments a split line when the complete join exists in the file', () => {
    expect(
      buildRepairDiagnosis(
        ['This is the UPDATED first file.'],
        ['This is the', 'UPDATED', 'first file.'],
      ),
    ).toContain('one whole file line')
  })
})

describe('closestLineHint', () => {
  it('returns the 1-based line of the best single-line match', () => {
    expect(closestLineHint(['const x = 1', 'const y = 2', 'const z = 3'], ['const y = 2'])).toBe(2)
    expect(closestLineHint(['foo', 'bar', 'baz'], ['barx'])).toBe(2) // closest by edit distance
  })
  it('returns the start line of the best multi-line block', () => {
    expect(closestLineHint(['x', 'a', 'b', 'y'], ['a', 'b'])).toBe(2)
  })
  it('null for an empty pattern or empty file', () => {
    expect(closestLineHint(['a'], [''])).toBeNull()
    expect(closestLineHint([], ['anything'])).toBeNull()
  })
})

describe('buildNotFoundHint', () => {
  it('names the closest line and quotes context; empty when nothing is near', () => {
    expect(buildNotFoundHint(['line1', 'line2', 'line3'], ['line2'])).toContain(
      'Closest match is near line 2.',
    )
    expect(buildNotFoundHint([], ['x'])).toBe('')
  })
})

describe('findMatch', () => {
  it('finds a byte-exact single-line match', () => {
    const m = findMatch(['a', 'b', 'c'], ['b'], 0, false)
    expect(m).toEqual({ index: 1, length: 1, exact: true, strategy: 'exact' })
  })

  it('treats an empty pattern as a zero-length match at start', () => {
    expect(findMatch(['a'], [], 3, false)).toEqual({
      index: 3,
      length: 0,
      exact: true,
      strategy: 'exact',
    })
  })

  it('returns null when nothing matches', () => {
    expect(findMatch(['a', 'b'], ['zzz'], 0, false)).toBeNull()
  })

  it('falls to trailing-whitespace tolerance (not exact) when only trailing ws differs', () => {
    const m = findMatch(['foo   ', 'bar'], ['foo'], 0, false)
    expect(m?.strategy).toBe('trailing-whitespace')
    expect(m?.exact).toBe(false)
    expect(m?.index).toBe(0)
  })

  it('matches a uniformly-reindented block at the indentation tolerance', () => {
    const file = ['    if (x) {', '      y()', '    }']
    const pattern = ['if (x) {', '  y()', '}']
    const m = findMatch(file, pattern, 0, false)
    expect(m?.strategy).toBe('indentation')
    expect(m?.index).toBe(0)
    expect(m?.length).toBe(3)
  })

  it('respects the start offset (matches the later occurrence)', () => {
    const m = findMatch(['x', 'x', 'x'], ['x'], 1, false)
    expect(m?.index).toBe(1)
  })

  it('with eof=true, anchors at the last possible window', () => {
    const m = findMatch(['x', 'x', 'x'], ['x'], 0, true)
    expect(m?.index).toBe(2)
  })
})

describe('findUniqueMatch', () => {
  it('returns the sole exact match', () => {
    const r = findUniqueMatch(['a', 'b', 'c'], ['b'])
    expect(r).toEqual({
      kind: 'match',
      match: { index: 1, length: 1, exact: true, strategy: 'exact' },
    })
  })

  it('reports ambiguity when two byte-exact occurrences exist', () => {
    const r = findUniqueMatch(['foo', 'foo'], ['foo'])
    expect(r).toEqual({ kind: 'ambiguous', strategy: 'exact', count: 2 })
  })

  it('judges uniqueness AT the tolerance level: one exact wins even if looser tiers would double-match', () => {
    // 'foo' is byte-exact only at index 0; 'foo  ' would also match under
    // trailing-whitespace, but the exact tier already has exactly one → match.
    const r = findUniqueMatch(['foo', 'foo  '], ['foo'])
    expect(r.kind).toBe('match')
    if (r.kind === 'match') {
      expect(r.match.strategy).toBe('exact')
      expect(r.match.index).toBe(0)
    }
  })

  it('returns none for no match and for an empty pattern', () => {
    expect(findUniqueMatch(['a'], ['zzz'])).toEqual({ kind: 'none' })
    expect(findUniqueMatch(['a'], [])).toEqual({ kind: 'none' })
  })
})

describe('reindentNewLines', () => {
  it('is a no-op when the matched line shares the pattern indentation', () => {
    const out = reindentNewLines(['  a', '  b'], '  old', '  file')
    expect(out).toEqual(['  a', '  b'])
  })

  it('shifts inserted lines to the file indentation when it differs from the pattern', () => {
    // pattern matched at indent 0, file is at indent 4 → new lines gain 4 spaces.
    const out = reindentNewLines(['x()', 'y()'], 'old', '    fileOld')
    expect(out).toEqual(['    x()', '    y()'])
  })

  it('leaves blank lines untouched while reindenting the rest', () => {
    const out = reindentNewLines(['a', '', 'b'], 'old', '  fileOld')
    expect(out).toEqual(['  a', '', '  b'])
  })
})

describe('describeStrategy', () => {
  it('maps each strategy to a human label', () => {
    expect(describeStrategy('exact')).toBe('exact')
    expect(describeStrategy('trimmed')).toBe('trimmed-lines')
    expect(describeStrategy('block-anchor')).toBe('block-anchor fuzzy')
    // Named explicitly so the tool result says WHAT was normalized, not "punctuation".
    expect(describeStrategy('punctuation')).toBe(
      'unicode-normalization (smart quotes/dashes/spaces)',
    )
  })
})

describe('findMatch — block-anchor is the only length-changing strategy', () => {
  it('block-anchor can match a region LONGER or SHORTER than the pattern', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    const pattern = ['a', 'b', 'c', 'c', 'd', 'e'] // one line duplicated
    const loose = findMatch(lines, pattern, 0, false)
    expect(loose?.strategy).toBe('block-anchor')
    expect(loose?.length).toBe(5) // region length ≠ pattern length — this is the hazard
  })

  it('skipBlockAnchor refuses it, so a malformed hunk reaches the repair path instead', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    const pattern = ['a', 'b', 'c', 'c', 'd', 'e']
    expect(findMatch(lines, pattern, 0, false, true)).toBeNull()
  })

  it('skipBlockAnchor still allows fuzzy, which is line-for-line', () => {
    const lines = ['const msg = "hello world here"', 'next']
    const pattern = ['const msg = "hello world her"'] // 1-char drift, within the 5% budget
    const m = findMatch(lines, pattern, 0, false, true)
    expect(m?.strategy).toBe('fuzzy')
    expect(m?.length).toBe(1)
  })
})
