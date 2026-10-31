import { describe, expect, test } from 'bun:test'
import { rankFiles } from './fuzzy-rank'

describe('path matching', () => {
  test('a path the query is not a subsequence of is not offered', () => {
    expect(rankFiles(['src/FileTab.tsx', 'a.ts'], 'zzz', 10)).toEqual([])
    expect(rankFiles(['a.ts'], 'abc', 10)).toEqual([])
  })

  test('a basename match is offered, an incidental scatter is not', () => {
    expect(
      rankFiles(['features/inspector/lib/abstract.ts', 'src/inspector/FileTab.tsx'], 'filetab', 10),
    ).toEqual(['src/inspector/FileTab.tsx'])
  })

  test('word-boundary matches rank above mid-word ones', () => {
    // Listed longest-last so path length alone would order them the other way.
    expect(rankFiles(['aqbocd.ts', 'src/quick-open.ts'], 'qo', 10)).toEqual([
      'src/quick-open.ts',
      'aqbocd.ts',
    ])
  })
})

describe('rankFiles', () => {
  const files = [
    'src/FileTab.tsx',
    'src/inspector/file-ops.ts',
    'README.md',
    'src/a/b/c/deep-file.ts',
  ]

  test('empty query → shortest paths first, capped', () => {
    expect(rankFiles(files, '', 2)).toEqual(['README.md', 'src/FileTab.tsx'])
  })

  test('ranks the best fuzzy match first and drops non-matches', () => {
    const ranked = rankFiles(files, 'filetab', 10)
    expect(ranked[0]).toBe('src/FileTab.tsx')
    expect(ranked).not.toContain('README.md') // no 'filetab' subsequence
  })

  test('respects the limit', () => {
    expect(rankFiles(files, 'file', 1)).toHaveLength(1)
  })

  test('whitespace-only query is treated as empty', () => {
    expect(rankFiles(files, '   ', 2)).toEqual(['README.md', 'src/FileTab.tsx'])
  })

  test('internal spaces are ignored (quick-open style): "file tab" matches FileTab', () => {
    const ranked = rankFiles(files, 'file tab', 10)
    expect(ranked[0]).toBe('src/FileTab.tsx')
  })
})
