import { describe, expect, it } from 'bun:test'
import { translateRustRegex } from './rust-regex'

/**
 * Each case below is a Rust-syntax pattern of the kind the manifests use.
 *
 * The naive implementation (`new RegExp(pattern)`) fails on these in TWO different ways, and the
 * assertions record which is which rather than assuming:
 *   - `(?i)…` and a `\x{..}-\x{..}` character-class range THROW a SyntaxError. Loud.
 *   - a bare `\x{2800}` outside a range does NOT throw: `\x` is an identity escape for `x` and
 *     `{2800}` becomes a quantifier, so it silently means "2800 letter x's" and can never fire.
 * Every test therefore also asserts a POSITIVE match on a realistic screen line — a translation
 * that merely compiles proves nothing.
 */
describe('translateRustRegex', () => {
  it('hoists a leading (?i) instead of failing to compile', () => {
    // bash_permission_prompt
    const pattern = String.raw`(?i)^\s*❯?\s*yes\b`
    expect(() => new RegExp(pattern)).toThrow() // JS has no inline flag groups
    const re = translateRustRegex(pattern)
    expect(re).not.toBeNull()
    expect(re?.flags).toContain('i')
    expect(re?.test('  ❯ Yes')).toBe(true)
    expect(re?.test('  ❯ yes, and don’t ask again')).toBe(true)
  })

  it('hoists (?m) so ^/$ are per-line', () => {
    // legacy_no_prompt_blocker `not` clause
    const pattern = String.raw`(?m)^\s*❯\s*$`
    const re = translateRustRegex(pattern)
    expect(re?.flags).toContain('m')
    expect(re?.test('some output\n❯\n')).toBe(true)
  })

  it('rewrites \\x{...} to \\u{...} and enables the u flag', () => {
    // osc_title_working, braille spinner range
    const pattern = String.raw`^[\x{2800}-\x{28FF}] `
    expect(() => new RegExp(pattern)).toThrow() // as a class range, JS rejects it outright
    // Outside a range the same escape is the SILENT failure mode: 'x' repeated 2800 times.
    expect(new RegExp(String.raw`\x{2800}`).test('⠀')).toBe(false)
    expect(translateRustRegex(String.raw`\x{2800}`)?.test('⠀')).toBe(true)
    const re = translateRustRegex(pattern)
    expect(re?.flags).toContain('u')
    expect(re?.test('⠁ building')).toBe(true)
    expect(re?.test('A building')).toBe(false)
  })

  it('handles a bare pattern with no flags and no escapes unchanged', () => {
    // screen_working_fallback
    const pattern = String.raw`^[•◦]\s+Working \([^)]*esc to interrupt\)(?: · .*)?$`
    const re = translateRustRegex(pattern)
    expect(re?.flags).toBe('')
    expect(re?.test('• Working (12s · esc to interrupt)')).toBe(true)
    expect(re?.test('• Done')).toBe(false)
  })

  it('stacks several leading flag groups', () => {
    const re = translateRustRegex(String.raw`(?i)(?m)^yes$`)
    expect(re?.flags).toContain('i')
    expect(re?.flags).toContain('m')
    expect(re?.test('no\nYES')).toBe(true)
  })

  it('returns null for a pattern that cannot compile, rather than throwing', () => {
    expect(translateRustRegex('(?P<name>unsupported')).toBeNull()
  })
})
