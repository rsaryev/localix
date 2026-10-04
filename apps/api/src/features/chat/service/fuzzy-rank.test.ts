import { describe, expect, test } from 'bun:test'
import { fuzzyScore, rankFiles } from './fuzzy-rank'

describe('fuzzyScore', () => {
  test('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('src/FileTab.tsx', 'zzz')).toBeNull()
    expect(fuzzyScore('a.ts', 'abc')).toBeNull()
  })

  test('a basename-substring match outscores an incidental scatter', () => {
    const direct = fuzzyScore('src/inspector/FileTab.tsx', 'filetab')! // basename substring → +5
    const scatter = fuzzyScore('features/inspector/lib/abstract.ts', 'filetab')
    // 'filetab' is not a subsequence of the scatter path → no match at all.
    expect(scatter).toBeNull()
    expect(direct).toBeGreaterThan(0)
  })

  test('word-boundary matches score higher than mid-word ones', () => {
    const boundary = fuzzyScore('src/quick-open.ts', 'qo')! // q at /, o at - → both boundaries
    const midword = fuzzyScore('aqbocd.ts', 'qo')! // q, o mid-word
    expect(boundary).toBeGreaterThan(midword)
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
