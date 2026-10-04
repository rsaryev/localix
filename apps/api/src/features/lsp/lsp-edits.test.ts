import { describe, expect, test } from 'bun:test'
import { applyTextEdits } from './lsp-edits'

const ed = (sl: number, sc: number, el: number, ec: number, newText: string) => ({
  range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
  newText,
})

describe('applyTextEdits', () => {
  test('applies a single in-line replacement', () => {
    const text = 'const foo = 1\n'
    expect(applyTextEdits(text, [ed(0, 6, 0, 9, 'bar')])).toBe('const bar = 1\n')
  })

  test('applies multiple edits on the same line correctly (descending order)', () => {
    // rename `foo` (cols 6-9) and `foo` again later (cols 12-15) on one line
    const text = 'let foo = foo + 1\n'
    const out = applyTextEdits(text, [ed(0, 4, 0, 7, 'bar'), ed(0, 10, 0, 13, 'bar')])
    expect(out).toBe('let bar = bar + 1\n')
  })

  test('applies edits across multiple lines', () => {
    const text = 'a\nfoo\nb\nfoo\n'
    const out = applyTextEdits(text, [ed(1, 0, 1, 3, 'X'), ed(3, 0, 3, 3, 'X')])
    expect(out).toBe('a\nX\nb\nX\n')
  })

  test('handles \\r\\n line endings', () => {
    const text = 'a\r\nfoo\r\nb\r\n'
    expect(applyTextEdits(text, [ed(1, 0, 1, 3, 'bar')])).toBe('a\r\nbar\r\nb\r\n')
  })

  test('no edits → unchanged', () => {
    expect(applyTextEdits('abc', [])).toBe('abc')
  })
})
