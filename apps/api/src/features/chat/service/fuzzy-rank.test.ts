import { describe, expect, test } from 'bun:test'
import { rankPaths } from './fuzzy-rank'

describe('path matching', () => {
  test('a path the query is not a subsequence of is not offered', () => {
    expect(rankPaths(['src/FileTab.tsx', 'a.ts'], 'zzz')).toEqual([])
    expect(rankPaths(['a.ts'], 'abc')).toEqual([])
  })

  test('a basename match is offered, an incidental scatter is not', () => {
    expect(
      rankPaths(['features/inspector/lib/abstract.ts', 'src/inspector/FileTab.tsx'], 'filetab'),
    ).toEqual(['src/inspector/FileTab.tsx'])
  })

  test('word-boundary matches rank above mid-word ones', () => {
    // Listed longest-last so path length alone would order them the other way.
    expect(rankPaths(['aqbocd.ts', 'src/quick-open.ts'], 'qo')).toEqual([
      'src/quick-open.ts',
      'aqbocd.ts',
    ])
  })
})

describe('rankPaths', () => {
  const files = [
    'src/FileTab.tsx',
    'src/inspector/file-ops.ts',
    'README.md',
    'src/a/b/c/deep-file.ts',
  ]

  test('empty query → shortest paths first', () => {
    expect(rankPaths(files, '').slice(0, 2)).toEqual(['README.md', 'src/FileTab.tsx'])
  })

  test('ranks the best fuzzy match first and drops non-matches', () => {
    const ranked = rankPaths(files, 'filetab')
    expect(ranked[0]).toBe('src/FileTab.tsx')
    expect(ranked).not.toContain('README.md') // no 'filetab' subsequence
  })

  test('whitespace-only query is treated as empty', () => {
    expect(rankPaths(files, '   ').slice(0, 2)).toEqual(['README.md', 'src/FileTab.tsx'])
  })

  test('internal spaces are ignored (quick-open style): "file tab" matches FileTab', () => {
    const ranked = rankPaths(files, 'file tab')
    expect(ranked[0]).toBe('src/FileTab.tsx')
  })
})
