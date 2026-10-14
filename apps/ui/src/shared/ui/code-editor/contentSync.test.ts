import { describe, expect, test } from 'bun:test'
import {
  minimalReplacement,
  modelHoldsValue,
  primaryChangeLine,
  toEditorContentChanges,
  type MonacoContentChange,
} from './contentSync'

/** Monaco change fixture (1-based, inclusive line range replaced by `text`). */
const change = (
  startLineNumber: number,
  endLineNumber: number,
  text: string,
): MonacoContentChange => ({
  range: { startLineNumber, endLineNumber },
  text,
})

describe('toEditorContentChanges', () => {
  test('single-character insert → one 0-based delta on the typed line', () => {
    // Typing "x" at line 4 (1-based): a collapsed range replaced by one character.
    const deltas = toEditorContentChanges([change(4, 4, 'x')])
    expect(deltas).toEqual([{ startLine: 3, endLine: 3, text: 'x' }])
    expect(primaryChangeLine(deltas)).toBe(3)
  })

  test('multi-cursor edit reports SEVERAL changes in ONE event', () => {
    // Monaco reports multi-caret edits bottom-up in a single event.
    const deltas = toEditorContentChanges([change(30, 30, '// '), change(9, 9, '// ')])
    expect(deltas).toEqual([
      { startLine: 29, endLine: 29, text: '// ' },
      { startLine: 8, endLine: 8, text: '// ' },
    ])
    // Attributed to the first edited line in DOCUMENT order, whatever the report order.
    expect(primaryChangeLine(deltas)).toBe(8)
    expect(primaryChangeLine([...deltas].reverse())).toBe(8)
  })

  test('paste over a selection → one delta spanning the replaced range', () => {
    const deltas = toEditorContentChanges([change(12, 18, 'pasted\nlines')])
    expect(deltas).toEqual([{ startLine: 11, endLine: 17, text: 'pasted\nlines' }])
    expect(primaryChangeLine(deltas)).toBe(11)
  })

  test('undo → the inverse delta, mapped like any other change', () => {
    // Undoing the paste above restores the original range; Monaco reports it as a plain
    // change (the range now covers the pasted text, the text is what was there before).
    const deltas = toEditorContentChanges([change(12, 13, 'original\nselection\nback')])
    expect(deltas).toEqual([{ startLine: 11, endLine: 12, text: 'original\nselection\nback' }])
    expect(primaryChangeLine(deltas)).toBe(11)
  })

  test('a deletion keeps its pre-edit range and an empty text', () => {
    expect(toEditorContentChanges([change(2, 5, '')])).toEqual([
      { startLine: 1, endLine: 4, text: '' },
    ])
  })

  test('no changes → nothing to attribute', () => {
    expect(toEditorContentChanges([])).toEqual([])
    expect(primaryChangeLine([])).toBeNull()
    expect(primaryChangeLine(undefined)).toBeNull()
  })
})

describe('modelHoldsValue (echo guard)', () => {
  test('echo: the value the model just produced is recognized WITHOUT reading it', () => {
    let reads = 0
    const typed = 'const a = 1\n'
    expect(modelHoldsValue(typed, typed, () => ((reads += 1), typed))).toBe(true)
    expect(reads).toBe(0)
  })

  test('external update arriving while the user types is NOT swallowed', () => {
    // The mirror holds what the user typed; a different `value` must be applied.
    expect(modelHoldsValue('typed by user', 'written by agent', () => 'typed by user')).toBe(false)
  })

  test('an untrusted mirror falls back to reading the model — same answer as always reading', () => {
    let reads = 0
    const read = () => {
      reads += 1
      return 'on disk'
    }
    expect(modelHoldsValue(null, 'on disk', read)).toBe(true) // no-op update still skipped
    expect(modelHoldsValue(null, 'something else', read)).toBe(false)
    expect(reads).toBe(2)
  })

  test('a stale-but-equal mirror and a model read agree by construction', () => {
    // The mirror is only ever set to text the model provably holds, so for any value the
    // guard answers exactly as the full read would.
    const text = 'a\nb\nc'
    for (const value of [text, 'a\nb', '', text + '\n']) {
      expect(modelHoldsValue(text, value, () => text)).toBe(
        modelHoldsValue(null, value, () => text),
      )
    }
  })
})

describe('minimalReplacement — external updates replace only what differs', () => {
  const apply = (before: string, after: string) => {
    const r = minimalReplacement(before, after)
    return r ? before.slice(0, r.start) + r.text + before.slice(r.end) : before
  }

  test('identical texts need no edit', () => {
    expect(minimalReplacement('same', 'same')).toBeNull()
  })

  test('an edit in the middle touches only that span', () => {
    const before = 'line 1\ntype A = strixng\nline 3\n'
    const after = 'line 1\ntype A = string\nline 3\n'
    const r = minimalReplacement(before, after)!
    expect(before.slice(r.start, r.end)).toBe('x')
    expect(r.text).toBe('')
    expect(apply(before, after)).toBe(after)
  })

  test('prefix and suffix never overlap on repeated text', () => {
    for (const [before, after] of [
      ['aaa', 'aaaa'],
      ['aaaa', 'aa'],
      ['abab', 'ab'],
      ['', 'new'],
      ['old', ''],
    ]) {
      expect(apply(before, after)).toBe(after)
    }
  })

  test('never splits a surrogate pair or a CRLF', () => {
    const emojiBefore = 'x😀y'
    const emojiAfter = 'x😃y'
    const r = minimalReplacement(emojiBefore, emojiAfter)!
    expect(emojiBefore.slice(r.start, r.end)).toBe('😀')
    expect(apply(emojiBefore, emojiAfter)).toBe(emojiAfter)

    const crlfBefore = 'a\r\nb'
    const crlfAfter = 'a\r\r\nb'
    const c = minimalReplacement(crlfBefore, crlfAfter)!
    expect(crlfBefore.slice(0, c.start).endsWith('\r')).toBe(false)
    expect(apply(crlfBefore, crlfAfter)).toBe(crlfAfter)
  })
})
