import { describe, expect, it } from 'bun:test'
import { computeWordDiffMarks } from './wordDiffMarks'

// Helper: extract the changed-span text from a buffer given the computed marks,
// so tests assert on WHAT gets highlighted (position-independent of the diff format).
function markedSpans(buffer: string, diff: string): string[] {
  const lines = buffer.split('\n')
  return computeWordDiffMarks(diff).map((m) => lines[m.line - 1].slice(m.from, m.to))
}

describe('computeWordDiffMarks', () => {
  it('marks only the changed span on a modified line, in new-file coordinates', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 42;',
      ' const c = 3;',
    ].join('\n')
    const marks = computeWordDiffMarks(diff)
    expect(marks).toEqual([{ line: 2, from: 10, to: 12 }])
    const buffer = 'const a = 1;\nconst b = 42;\nconst c = 3;'
    expect(markedSpans(buffer, diff)).toEqual(['42'])
  })

  it('emits no marks for a whole-line rewrite (no shared text)', () => {
    const diff = ['@@ -1 +1 @@', '-alpha beta', '+gamma delta'].join('\n')
    expect(computeWordDiffMarks(diff)).toEqual([])
  })

  it('emits no marks for pure additions (nothing to word-diff against)', () => {
    const diff = ['@@ -1,1 +1,2 @@', ' kept', '+brand new line'].join('\n')
    expect(computeWordDiffMarks(diff)).toEqual([])
  })

  it('handles multiple changed spans on one line', () => {
    const diff = ['@@ -1 +1 @@', '-foo x bar', '+FOO x BAR'].join('\n')
    const buffer = 'FOO x BAR'
    expect(markedSpans(buffer, diff)).toEqual(['FOO', 'BAR'])
  })

  it('returns [] for empty diff', () => {
    expect(computeWordDiffMarks('')).toEqual([])
  })
})
