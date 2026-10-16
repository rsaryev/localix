import { describe, expect, test } from 'bun:test'
import type { VfCapture } from '@localixai/visual-feedback/protocol'
import { previewPickMode, quickAddText } from './previewSelection'

const cap = (over: Partial<VfCapture>): Pick<VfCapture, 'kind' | 'text'> => ({
  kind: 'element',
  ...over,
})

describe('previewPickMode', () => {
  test('a text selection with content → quick-add', () => {
    expect(previewPickMode(cap({ kind: 'text', text: 'hello world' }))).toBe('quick-add')
  })
  test('a text selection with only whitespace → comment (nothing to add)', () => {
    expect(previewPickMode(cap({ kind: 'text', text: '   ' }))).toBe('comment')
  })
  test('a text selection with no text → comment', () => {
    expect(previewPickMode(cap({ kind: 'text' }))).toBe('comment')
  })
  test('an element pick → comment', () => {
    expect(previewPickMode(cap({ kind: 'element', text: 'nearby label' }))).toBe('comment')
  })
  test('an area pick → comment', () => {
    expect(previewPickMode(cap({ kind: 'area' }))).toBe('comment')
  })
  test('a multi pick → comment', () => {
    expect(previewPickMode(cap({ kind: 'multi' }))).toBe('comment')
  })
})

describe('quickAddText', () => {
  test('trims the selected text', () => {
    expect(quickAddText({ text: '  spaced  ' })).toBe('spaced')
  })
  test('missing text → empty string', () => {
    expect(quickAddText({})).toBe('')
  })
})
