import { describe, expect, it } from 'bun:test'
import { computeReplacement } from './replacePreview'

describe('computeReplacement', () => {
  it('replaces a literal match', () => {
    expect(computeReplacement('const', 'const', 'let')).toBe('let')
  })

  it('keeps $ literal in non-regex replacement', () => {
    expect(computeReplacement('price', 'price', '$amount')).toBe('$amount')
  })

  it('expands capture references in regex mode', () => {
    expect(computeReplacement('foo123', 'foo(\\d+)', 'bar$1', { regex: true })).toBe('bar123')
  })

  it('is smart-case: lowercase query matches mixed case', () => {
    // The matched span is what ripgrep highlighted; replacement is verbatim.
    expect(computeReplacement('Const', 'const', 'let')).toBe('let')
  })

  it('respects case-sensitive (no match → unchanged span)', () => {
    expect(computeReplacement('Const', 'const', 'let', { caseSensitive: true })).toBe('Const')
  })

  it('whole-word still substitutes the exact word', () => {
    expect(computeReplacement('a', 'a', 'x', { wholeWord: true })).toBe('x')
  })

  it('returns null for an invalid regex', () => {
    expect(computeReplacement('x', '(', 'y', { regex: true })).toBeNull()
  })

  it('returns null for an empty query', () => {
    expect(computeReplacement('x', '', 'y')).toBeNull()
  })
})
