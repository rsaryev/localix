import { describe, expect, it } from 'bun:test'
import { ensureFinalNewline, joinLines, sortLines, trimTrailingWhitespace } from './lineOps'

describe('sortLines', () => {
  it('sorts ascending lexicographically', () => {
    expect(sortLines(['banana', 'apple', 'cherry'], false)).toEqual(['apple', 'banana', 'cherry'])
  })

  it('sorts descending', () => {
    expect(sortLines(['apple', 'banana', 'cherry'], true)).toEqual(['cherry', 'banana', 'apple'])
  })

  it('is stable on already-sorted input', () => {
    expect(sortLines(['a', 'b', 'c'], false)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = ['b', 'a']
    sortLines(input, false)
    expect(input).toEqual(['b', 'a'])
  })
})

describe('trimTrailingWhitespace', () => {
  it('strips trailing spaces and tabs per line', () => {
    expect(trimTrailingWhitespace('foo  \nbar\t\nbaz')).toBe('foo\nbar\nbaz')
  })

  it('preserves leading indentation', () => {
    expect(trimTrailingWhitespace('  foo   \n\tbar ')).toBe('  foo\n\tbar')
  })

  it('leaves clean text unchanged', () => {
    expect(trimTrailingWhitespace('a\nb\nc')).toBe('a\nb\nc')
  })

  it('collapses a whitespace-only line to empty', () => {
    expect(trimTrailingWhitespace('a\n   \nb')).toBe('a\n\nb')
  })
})

describe('ensureFinalNewline', () => {
  it('adds a newline when missing', () => {
    expect(ensureFinalNewline('foo')).toBe('foo\n')
    expect(ensureFinalNewline('foo\nbar')).toBe('foo\nbar\n')
  })

  it('leaves a single trailing newline unchanged (idempotent)', () => {
    expect(ensureFinalNewline('foo\n')).toBe('foo\n')
    expect(ensureFinalNewline(ensureFinalNewline('foo'))).toBe('foo\n')
  })

  it('collapses multiple trailing newlines to one', () => {
    expect(ensureFinalNewline('foo\n\n\n')).toBe('foo\n')
    expect(ensureFinalNewline('foo\nbar\n\n')).toBe('foo\nbar\n')
  })

  it('leaves an empty file empty (no newline added to zero bytes)', () => {
    expect(ensureFinalNewline('')).toBe('')
  })

  it('preserves CRLF line endings', () => {
    expect(ensureFinalNewline('foo\r\nbar')).toBe('foo\r\nbar\r\n')
    expect(ensureFinalNewline('foo\r\nbar\r\n')).toBe('foo\r\nbar\r\n')
    expect(ensureFinalNewline('foo\r\nbar\r\n\r\n')).toBe('foo\r\nbar\r\n')
  })
})

describe('joinLines', () => {
  it('joins two lines with a single space, dropping indentation', () => {
    expect(joinLines(['const x =', '    42'])).toBe('const x = 42')
  })

  it('trims trailing whitespace at the seam', () => {
    expect(joinLines(['foo   ', 'bar'])).toBe('foo bar')
  })

  it('collapses blank lines instead of leaving double spaces', () => {
    expect(joinLines(['foo', '', 'bar'])).toBe('foo bar')
  })

  it('returns a single line unchanged (trimmed)', () => {
    expect(joinLines(['solo  '])).toBe('solo')
  })
})
