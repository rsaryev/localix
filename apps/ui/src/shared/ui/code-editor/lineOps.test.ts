import { describe, expect, it } from 'bun:test'
import { ensureFinalNewline, trimTrailingWhitespace } from './lineOps'

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
