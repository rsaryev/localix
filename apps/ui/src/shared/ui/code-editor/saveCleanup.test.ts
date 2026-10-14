import { describe, expect, it } from 'bun:test'
import { applySaveCleanup, composeOnSaveContent } from './saveCleanup'

describe('applySaveCleanup', () => {
  it('is a no-op when both flags are off (default, non-regressive)', () => {
    const input = 'foo  \nbar\t\n\n\n'
    expect(
      applySaveCleanup(input, { trimTrailingWhitespace: false, ensureFinalNewline: false }),
    ).toBe(input)
  })

  it('trims trailing whitespace when only that flag is on', () => {
    expect(
      applySaveCleanup('foo  \nbar\t', { trimTrailingWhitespace: true, ensureFinalNewline: false }),
    ).toBe('foo\nbar')
  })

  it('ensures a final newline when only that flag is on', () => {
    expect(
      applySaveCleanup('foo  \nbar', { trimTrailingWhitespace: false, ensureFinalNewline: true }),
    ).toBe('foo  \nbar\n')
  })

  it('applies both transforms in order (trim then final newline)', () => {
    // The whitespace-only last line trims to empty, then the trailing blank
    // lines collapse to exactly one newline.
    expect(
      applySaveCleanup('foo  \nbar\t\n   \n', {
        trimTrailingWhitespace: true,
        ensureFinalNewline: true,
      }),
    ).toBe('foo\nbar\n')
  })

  it('leaves an empty file empty with both flags on', () => {
    expect(applySaveCleanup('', { trimTrailingWhitespace: true, ensureFinalNewline: true })).toBe(
      '',
    )
  })
})

describe('composeOnSaveContent (format → text cleanups)', () => {
  const bothOn = { trimTrailingWhitespace: true, ensureFinalNewline: true }
  const bothOff = { trimTrailingWhitespace: false, ensureFinalNewline: false }

  it('falls back to the raw buffer when the formatter is unavailable (null)', () => {
    // Fail-safe: format-on-save enabled but no formatter → the buffer is used,
    // still passed through the enabled cleanups so a save is never lost.
    expect(composeOnSaveContent('foo  \nbar', null, bothOn)).toBe('foo\nbar\n')
  })

  it('uses the formatter output as the base, not the buffer', () => {
    // The formatted text (not the stale buffer) is what the cleanups compose over.
    expect(composeOnSaveContent('unformatted', 'formatted  \n', bothOn)).toBe('formatted\n')
  })

  it('applies cleanups AFTER formatting (order: format → trim → final-newline)', () => {
    // A formatter that leaves a trailing space + no final newline still gets cleaned.
    expect(composeOnSaveContent('x', 'const a = 1 ', bothOn)).toBe('const a = 1\n')
  })

  it('is a pass-through of the formatted text when cleanups are off', () => {
    expect(composeOnSaveContent('x', 'const a = 1 \n', bothOff)).toBe('const a = 1 \n')
  })

  it('returns the raw buffer unchanged when formatter null and cleanups off', () => {
    const buffer = 'foo  \nbar\t\n'
    expect(composeOnSaveContent(buffer, null, bothOff)).toBe(buffer)
  })
})
