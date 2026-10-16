import { describe, expect, test } from 'bun:test'
import { normalizeEditorSelection } from './selection'

describe('normalizeEditorSelection', () => {
  test('keeps a forward selection in ascending document order', () => {
    expect(
      normalizeEditorSelection({ line: 2, column: 4 }, { line: 5, column: 9 }, 'chosen'),
    ).toEqual({
      text: 'chosen',
      startLine: 2,
      startColumn: 4,
      endLine: 5,
      endColumn: 9,
    })
  })

  test('normalizes a backward selection without changing its exact text', () => {
    expect(
      normalizeEditorSelection({ line: 8, column: 12 }, { line: 3, column: 2 }, 'exact\ncode'),
    ).toEqual({
      text: 'exact\ncode',
      startLine: 3,
      startColumn: 2,
      endLine: 8,
      endColumn: 12,
    })
  })

  test('returns null for an empty selection', () => {
    expect(normalizeEditorSelection({ line: 4, column: 7 }, { line: 4, column: 7 }, '')).toBeNull()
  })
})
