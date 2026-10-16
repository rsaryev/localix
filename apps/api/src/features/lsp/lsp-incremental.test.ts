import { describe, expect, test } from 'bun:test'

import { minimalEdit, positionAt } from './lsp-incremental'

/** Apply an edit the way a language server would, to check it reconstructs `after`. */
function apply(before: string, edit: ReturnType<typeof minimalEdit>): string {
  if (!edit) return before
  const offsetOf = (p: { line: number; character: number }) => {
    let offset = 0
    for (let line = 0; line < p.line; line++) offset = before.indexOf('\n', offset) + 1
    return offset + p.character
  }
  return (
    before.slice(0, offsetOf(edit.range.start)) + edit.text + before.slice(offsetOf(edit.range.end))
  )
}

/** Every case must round-trip: applying the edit to `before` must yield `after`. */
const roundTrips = (before: string, after: string) => apply(before, minimalEdit(before, after))

describe('minimalEdit', () => {
  test('identical documents produce no edit at all', () => {
    expect(minimalEdit('same', 'same')).toBeNull()
  })

  test('a typed character sends the character, not the document', () => {
    const before = 'const a = 1\nconst b = 2\n'
    const after = 'const a = 1\nconst b = 22\n'
    const edit = minimalEdit(before, after)

    expect(edit?.text).toBe('2')
    expect(edit?.range.start).toEqual({ line: 1, character: 11 })
    expect(roundTrips(before, after)).toBe(after)
  })

  test('a deletion sends an empty replacement over the removed span', () => {
    const before = 'alpha\nbeta\ngamma\n'
    const after = 'alpha\ngamma\n'
    const edit = minimalEdit(before, after)

    expect(edit?.text).toBe('')
    expect(roundTrips(before, after)).toBe(after)
  })

  test('repeated characters do not produce a backwards range', () => {
    // The suffix scan must not run back past where the prefix scan stopped.
    // Indentation is made of repeated characters, so this is the common case, not a
    // corner one — an overlapping scan yields end < start and a server rejects it.
    for (const [before, after] of [
      ['aa', 'aaa'],
      ['aaa', 'aa'],
      ['    x', '        x'],
      ['\n\n\n', '\n\n'],
    ] as const) {
      const edit = minimalEdit(before, after)
      const start = edit!.range.start
      const end = edit!.range.end
      expect(
        end.line > start.line || (end.line === start.line && end.character >= start.character),
      ).toBe(true)
      expect(roundTrips(before, after)).toBe(after)
    }
  })

  test('an edit spanning lines round-trips', () => {
    const before = 'one\ntwo\nthree\nfour\n'
    const after = 'one\nTWO\nTHREE\nfour\n'
    expect(roundTrips(before, after)).toBe(after)
  })

  test('a wholesale rewrite still works — it just degenerates to the whole document', () => {
    const before = 'completely\ndifferent\n'
    const after = 'nothing\nin\ncommon\n'
    expect(roundTrips(before, after)).toBe(after)
  })

  test('an empty document in either direction round-trips', () => {
    expect(roundTrips('', 'hello')).toBe('hello')
    expect(roundTrips('hello', '')).toBe('')
  })

  test('the payload is a delta, not the document', () => {
    const body = 'export const x = 1\n'.repeat(50_000) // ~1 MB
    const edit = minimalEdit(body, `${body}// tail\n`)

    expect(edit?.text).toBe('// tail\n')
    expect(edit!.text.length).toBeLessThan(100)
  })

  test('multi-byte characters are indexed as UTF-16 code units, as LSP requires', () => {
    // An emoji is one code POINT but two code UNITS. Getting this wrong shifts every
    // position after it, and the server would then edit the wrong span.
    const before = 'a🎉b\nsecond\n'
    const after = 'a🎉bc\nsecond\n'
    const edit = minimalEdit(before, after)

    expect(edit?.text).toBe('c')
    expect(edit?.range.start).toEqual({ line: 0, character: 4 })
    expect(roundTrips(before, after)).toBe(after)
  })
})

describe('positionAt', () => {
  test('counts lines and code units, and clamps out-of-range offsets', () => {
    const text = 'ab\ncd\n'
    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 })
    expect(positionAt(text, 3)).toEqual({ line: 1, character: 0 })
    expect(positionAt(text, 5)).toEqual({ line: 1, character: 2 })
    expect(positionAt(text, 999)).toEqual({ line: 2, character: 0 })
    expect(positionAt(text, -5)).toEqual({ line: 0, character: 0 })
  })
})
