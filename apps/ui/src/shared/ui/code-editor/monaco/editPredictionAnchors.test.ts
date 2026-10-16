import { expect, it } from 'bun:test'
import { caretInsertion } from './editPredictionAnchors'
import type { EditorSuggestion } from '../types'

const suggestion = (original: string, replacement: string): EditorSuggestion => ({
  id: 'test',
  kind: 'suggestion',
  source: 'edit-prediction',
  startLine: 1,
  endLine: original.split('\n').length,
  original,
  replacement,
})
const position = (lineNumber: number, column: number) => ({ lineNumber, column }) as never

it('extracts only an insertion at the caret, including before existing closing syntax', () => {
  expect(caretInsertion(suggestion('call()', 'call(value)'), position(1, 6))).toBe('value')
  expect(caretInsertion(suggestion('a\nb', 'a\nbc\nd'), position(2, 2))).toBe('c\nd')
  expect(caretInsertion(suggestion('const a = 1', 'const a = 2'), position(1, 12))).toBeNull()
  expect(caretInsertion(suggestion('abc', 'abcd'), position(1, 2))).toBeNull()
  expect(caretInsertion(suggestion('abc', 'abcd'), position(2, 1))).toBeNull()
})
