import { describe, expect, test } from 'bun:test'
import { evaluatePaste, buildPastePreview } from './terminalPaste'

describe('evaluatePaste', () => {
  test('single line pastes as-is', () => {
    expect(evaluatePaste('ls -la', false)).toEqual({ kind: 'paste', text: 'ls -la' })
  })

  test('bracketed paste mode never warns, even multi-line', () => {
    const text = 'echo a\necho b\necho c'
    expect(evaluatePaste(text, true)).toEqual({ kind: 'paste', text })
  })

  test('command with a single trailing newline is stripped (no auto-run)', () => {
    expect(evaluatePaste('rm -rf /\n', false)).toEqual({ kind: 'paste', text: 'rm -rf /' })
  })

  test('trailing CRLF is stripped too', () => {
    expect(evaluatePaste('git status\r\n', false)).toEqual({ kind: 'paste', text: 'git status' })
  })

  test('trailing whitespace-only second line is stripped', () => {
    expect(evaluatePaste('deploy\n   ', false)).toEqual({ kind: 'paste', text: 'deploy' })
  })

  test('genuine multi-line paste requires confirmation', () => {
    const text = 'echo one\necho two'
    const decision = evaluatePaste(text, false)
    expect(decision.kind).toBe('confirm')
    if (decision.kind === 'confirm') {
      expect(decision.lineCount).toBe(2)
      expect(decision.text).toBe(text)
      expect(decision.preview).toBe('echo one\necho two')
    }
  })

  test('two real command lines with a trailing newline still confirm', () => {
    const decision = evaluatePaste('echo one\necho two\n', false)
    // splits to ['echo one','echo two',''] → 3 lines, not the trailing-only case
    expect(decision.kind).toBe('confirm')
    if (decision.kind === 'confirm') expect(decision.lineCount).toBe(3)
  })
})

describe('buildPastePreview', () => {
  test('elides after three lines', () => {
    expect(buildPastePreview(['a', 'b', 'c', 'd'])).toBe('a\nb\nc\n…')
  })

  test('truncates long lines', () => {
    const long = 'x'.repeat(60)
    expect(buildPastePreview([long])).toBe(`${'x'.repeat(40)}…`)
  })

  test('short input is returned verbatim', () => {
    expect(buildPastePreview(['one', 'two'])).toBe('one\ntwo')
  })
})
