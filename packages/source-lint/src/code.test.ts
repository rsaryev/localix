import { describe, expect, test } from 'bun:test'
import { codeOnly } from './code'

describe('codeOnly blanks comments', () => {
  test('a line comment goes, and takes the guard token with it', () => {
    // The flagship case: a plugin order-path lint matched its own token inside a commented-out
    // line, so the hedge-mode guard could be commented out ENTIRELY and the lint stayed green.
    const src =
      '// const target = await run(() => resolveCloseTarget(ex, symbol))\nawait ex.closePosition(symbol)\n'
    expect(codeOnly(src)).not.toContain('resolveCloseTarget')
    expect(codeOnly(src)).toContain('ex.closePosition(symbol)')
  })

  test('a block comment goes, however many lines it spans', () => {
    const src = '/**\n * We never call finalStopReason by hand here.\n */\nconst x = 1\n'
    expect(codeOnly(src)).not.toContain('finalStopReason')
    expect(codeOnly(src)).toContain('const x = 1')
  })

  test('offsets are preserved, so an ORDERING lint stays meaningful', () => {
    // A lint asserting "the guard appears before the native call" compares `.search()` indices.
    // Shrinking the file as we strip would silently reorder them.
    const src = 'const a = 1 // note\nconst b = 2\n'
    expect(codeOnly(src)).toHaveLength(src.length)
    expect(codeOnly(src).indexOf('const b')).toBe(src.indexOf('const b'))
  })
})

describe('codeOnly does not mistake code for a comment', () => {
  test('a `//` inside a string literal is not a comment', () => {
    const src = "const url = 'https://api.example.com/v1'\nconst kept = 1\n"
    expect(codeOnly(src)).toContain('const kept = 1')
    expect(codeOnly(src)).toContain('api.example.com')
  })

  test('a string that IS code stays matchable — blanking strings would blind the lints', () => {
    // Real lints match string literals on purpose: `kind === 'ambiguous'`, a timeframe `'1h'`, an
    // option key. The stripper steps OVER strings; it does not erase them.
    const src = "if (kind === 'ambiguous') refuse()\n"
    expect(codeOnly(src)).toContain("kind === 'ambiguous'")
  })

  test('an apostrophe inside a REGEX does not open a string and eat the rest of the file', () => {
    // The sharp edge the old hand-rolled strippers had no idea about. Seeing `'` here, a
    // regex-blind scanner enters string mode and skips forward hunting a closing quote — swallowing
    // every line until it finds one. The guarded call below simply ceases to exist, and the lint
    // that watches for it reports clean.
    const src = "const re = /won't/\nawait resolveCloseTarget(ex, symbol)\nconst tail = 'x'\n"
    expect(codeOnly(src)).toContain('resolveCloseTarget(ex, symbol)')
  })

  test('a `/*` inside a regex character class does not open a block comment', () => {
    const src = 'const re = /[/*]/\nawait resolveCloseTarget(ex, symbol)\n'
    expect(codeOnly(src)).toContain('resolveCloseTarget(ex, symbol)')
  })

  test('a `//` inside a regex is not a comment', () => {
    const src = 'const re = /[a-z]+[/][/]/\nconst kept = 1\n'
    expect(codeOnly(src)).toContain('const kept = 1')
  })

  test('division is still division — a `/` after an identifier does not open a regex', () => {
    const src = 'const ratio = filled / total\nconst kept = 1\n'
    expect(codeOnly(src)).toContain('const ratio = filled / total')
    expect(codeOnly(src)).toContain('const kept = 1')
  })

  test('a keyword before the slash DOES open a regex', () => {
    const src = "return /won't/.test(s)\nconst kept = 1\n"
    expect(codeOnly(src)).toContain('const kept = 1')
  })

  test('an escaped quote inside a string does not end it', () => {
    const src = "const s = 'it\\'s fine' // gone\nconst kept = 1\n"
    const out = codeOnly(src)
    expect(out).toContain('const kept = 1')
    expect(out).not.toContain('gone')
  })

  test('a comment INSIDE a string survives, because it is not a comment', () => {
    const src = "const s = '// not a comment'\n"
    expect(codeOnly(src)).toContain('not a comment')
  })
})
