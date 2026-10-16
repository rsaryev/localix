import { describe, expect, test } from 'bun:test'
import { restoredPosition, revealSelection } from './revealRange'

const model = (lines: number[]) => ({
  getLineCount: () => lines.length,
  getLineMaxColumn: (line: number) => (lines[line - 1] ?? 0) + 1,
})

describe('revealSelection', () => {
  test('returns null without a positive line', () => {
    expect(revealSelection(model([3]), {})).toBeNull()
    expect(revealSelection(model([3]), { line: 0 })).toBeNull()
  })

  test('collapses to a caret when no end is given', () => {
    expect(revealSelection(model([10, 10]), { line: 2, column: 4 })).toEqual({
      lineNumber: 2,
      column: 5,
      endLineNumber: 2,
      endColumn: 5,
    })
  })

  test('clamps lines and columns to the model', () => {
    expect(
      revealSelection(model([3, 5]), { line: 9, column: 40, endLine: 1, endColumn: 99 }),
    ).toEqual({ lineNumber: 2, column: 6, endLineNumber: 2, endColumn: 6 })
  })

  test('spans to the requested end', () => {
    expect(
      revealSelection(model([3, 5, 8]), { line: 1, column: 1, endLine: 3, endColumn: 2 }),
    ).toEqual({ lineNumber: 1, column: 2, endLineNumber: 3, endColumn: 3 })
  })
})

describe('restoredPosition', () => {
  test('clamps a stale snapshot into the current document', () => {
    expect(restoredPosition(model([2, 4]), { line: 7, column: 50, top: 9 })).toEqual({
      lineNumber: 2,
      column: 5,
      top: 2,
    })
    expect(restoredPosition(model([2]), { line: 0, column: -3, top: 0 })).toEqual({
      lineNumber: 1,
      column: 1,
      top: 1,
    })
  })
})
