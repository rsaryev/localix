import { describe, expect, test } from 'bun:test'
import { clampConsoleHead, clampConsoleTail, consoleLastLine } from './consoleTail'

// A running command's collapsed row shows this line instead of an auto-opened console.
describe('consoleLastLine', () => {
  test('the last line with text, as one inert line', () => {
    expect(consoleLastLine('compiling\n\u001b[32m✓ 12 passed\u001b[0m\n\n')).toBe('✓ 12 passed')
    expect(consoleLastLine('a\r\nb\r\n')).toBe('b')
  })

  test('a line redrawn with carriage returns reads as its latest state', () => {
    expect(consoleLastLine('downloading  10%\rdownloading  55%\rdownloading 100%')).toBe(
      'downloading 100%',
    )
  })

  test('no text yet is no line, and a long line is cut', () => {
    expect(consoleLastLine('')).toBeUndefined()
    expect(consoleLastLine('\n \n\u001b[2K\n')).toBeUndefined()
    expect(consoleLastLine('x'.repeat(500), 20)).toHaveLength(20)
  })
})

describe('clampConsoleTail', () => {
  test('returns short output unchanged', () => {
    expect(clampConsoleTail('hello\nworld', 100)).toBe('hello\nworld')
    expect(clampConsoleTail('', 100)).toBe('')
  })

  test('keeps the tail and marks the truncation', () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const out = clampConsoleTail(output, 40)
    expect(out.startsWith('…earlier output truncated…\n')).toBe(true)
    expect(out.endsWith('line 49')).toBe(true)
    // The marker + the kept tail are bounded by maxChars + the marker line.
    expect(out.length).toBeLessThan(output.length)
  })

  test('drops the partial leading line so the tail starts clean', () => {
    // Slicing the last 10 chars of "aaaa\nbbbbbbbbbb" lands mid-second-line.
    const out = clampConsoleTail('aaaaaaaaaa\nbbbbb', 8)
    expect(out).toBe('…earlier output truncated…\nbbbbb')
  })

  test('handles a tail with no newline (single very long line)', () => {
    const out = clampConsoleTail('x'.repeat(100), 10)
    expect(out.startsWith('…earlier output truncated…\n')).toBe(true)
    expect(out.endsWith('x')).toBe(true)
  })
})

describe('clampConsoleHead', () => {
  test('keeps tool input beginnings and marks omitted trailing input', () => {
    const input = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const out = clampConsoleHead(input, 40)

    expect(out.startsWith('line 0\n')).toBe(true)
    expect(out.endsWith('…later input truncated…')).toBe(true)
    expect(out).not.toContain('line 49')
  })

  test('returns short input unchanged and safely clips one huge line', () => {
    expect(clampConsoleHead('echo ok', 100)).toBe('echo ok')
    expect(clampConsoleHead('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}\n…later input truncated…`)
  })
})
