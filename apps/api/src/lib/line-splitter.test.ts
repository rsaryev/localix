import { describe, expect, test } from 'bun:test'

import { createLineSplitter, LINE_TRUNCATION_MARKER } from './line-splitter'

/**
 * The two bugs this module exists to prevent, asserted directly: a line split across chunks
 * must be ONE line, and a final line without a terminator must not disappear. Both are
 * notification-shaped failures (a monitor event double-counted, or never delivered), which is
 * why they are worth a test rather than a comment.
 */
describe('createLineSplitter', () => {
  test('joins a line split across chunks and holds the partial tail', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('build: ')).toEqual([])
    expect(splitter.push('success\n')).toEqual(['build: success'])
  })

  test('emits every complete line in one chunk and keeps the remainder pending', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('a\nb\nc')).toEqual(['a', 'b'])
    expect(splitter.flush()).toEqual(['c'])
    // Flushed once: a second flush must not replay the line (a replayed event = a second wake).
    expect(splitter.flush()).toEqual([])
  })

  test('treats \\r\\n and a lone \\r as terminators', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('one\r\ntwo\rthree\n')).toEqual(['one', 'two', 'three'])
  })

  test('drops blank lines', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('\n\n  \nreal\n')).toEqual(['real'])
  })

  test('cuts a terminator-less monster line instead of buffering it forever', () => {
    const splitter = createLineSplitter(10)
    const out = splitter.push('x'.repeat(25))
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(`${'x'.repeat(10)}${LINE_TRUNCATION_MARKER}`)
    // Nothing left pending: the cut released the buffer.
    expect(splitter.flush()).toEqual([])
  })

  test('truncates a long line with the marker the plugin monitor host asserts', () => {
    const splitter = createLineSplitter(5)
    expect(splitter.push('abcdefghij\n')).toEqual([`abcde${LINE_TRUNCATION_MARKER}`])
  })
})
