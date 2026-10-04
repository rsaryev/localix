import { describe, expect, it } from 'bun:test'
import { applyUpdateChunks } from './patch-apply'
import { buildUpdatedRegions } from './patch-report'
import type { UpdateChunk } from './patch-parse'

const chunk = (oldLines: string[], newLines: string[]): UpdateChunk => ({
  oldLines,
  newLines,
  isEndOfFile: false,
})

// Unit coverage for the UNIQUE-only chunk repair that rescues two weak-model
// diff-construction mistakes — and proves an ambiguous/unclear case still fails
// loudly rather than misapplying.
describe('applyUpdateChunks chunk repair', () => {
  it('dedups a phantom anchor: a line used as both context and "-" (S5)', () => {
    // File has ONE `def add` line; the model emitted it as context AND as a
    // removal, producing two consecutive `def add` old-lines that never match.
    const original = 'def add(a, b):\n    return a + b\n'
    const c = chunk(
      ['def add(a, b):', 'def add(a, b):', '    return a + b'],
      [
        'def add(a, b):',
        'def sub(a, b):',
        '    return a - b',
        '',
        '',
        'def plus(a, b):',
        '    return a + b',
      ],
    )
    const out = applyUpdateChunks(original, 'app.py', [c])
    expect(out).toBe('def sub(a, b):\n    return a - b\n\n\ndef plus(a, b):\n    return a + b\n')
  })

  it('rejoins a file line the model split into fragments (S3)', () => {
    // The real line is one line; the model split it across context/-/+.
    const original = 'This is the UPDATED first file.\n'
    const c = chunk(
      ['This is the', 'UPDATED', 'first file.'],
      ['This is the', 'MODIFIED', 'first file.'],
    )
    const out = applyUpdateChunks(original, 'x.md', [c])
    expect(out).toBe('This is the MODIFIED first file.\n')
  })

  it('fails loudly when a fragment rejoin has no unique whole-line target', () => {
    // Joined "x = 1" is not equal to any whole file line → repair refuses.
    const original = 'let x = 1 here\nconst x = 1 there\n'
    const ambiguous = chunk(['x', '= 1'], ['x', '= 2'])
    expect(() => applyUpdateChunks(original, 'amb.ts', [ambiguous])).toThrow(
      /Failed to locate the context block/,
    )
  })

  it('fails loudly when the deduped anchor matches in two places', () => {
    // Two `foo` lines: deduping the phantom anchor to `['foo']` is ambiguous.
    const original = 'foo\nbar\nfoo\nbaz\n'
    const c = chunk(['foo', 'foo'], ['foo', 'qux'])
    expect(() => applyUpdateChunks(original, 'dup.ts', [c])).toThrow(
      /Failed to locate the context block/,
    )
  })

  it('a not-found error on a large file quotes ±10 CURRENT lines around the best candidate', () => {
    // Wide enough that the lines the model meant are usually inside the excerpt,
    // so the retry needs no read round-trip — and the advice says exactly that.
    const original = `${Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')}\n`
    const bad = chunk(['line 30 WRONG'], ['line 30 FIXED'])
    let message = ''
    try {
      applyUpdateChunks(original, 'big.ts', [bad])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('Actual lines 20-40')
    expect(message).toContain('CURRENT content')
    expect(message).toContain('20\tline 20')
    expect(message).toContain('40\tline 40')
    expect(message).toContain('without re-reading the file')
    // Too large for the whole-file dump — the excerpt is the fresh context.
    expect(message).not.toContain('The full file (')
  })

  it('emits a tuned diagnosis + whole-file dump for a small file on failure', () => {
    const original = 'line one\nline two\nline three\n'
    const bad = chunk(['nope', 'nope'], ['nope', 'x'])
    let message = ''
    try {
      applyUpdateChunks(original, 'tiny.ts', [bad])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('The full file (3 lines)')
    expect(message).toContain('repeated the line')
    expect(message).toContain('Actual lines')
  })
})

// Weak models emit no-op hunks (byte-identical "-"/"+" lines,
// so the before-image equals the after-image) alongside a real edit. A pointless
// (possibly unlocatable) no-op must never fail the whole file — skip it when the file
// has a substantive change. If EVERY hunk is a no-op, the existing behavior/error
// stands (never a silent fake success).
describe('applyUpdateChunks no-op skipping', () => {
  it('skips a no-op hunk when a substantive sibling exists, and notes it', () => {
    const original = 'alpha\nbeta\ngamma\n'
    // This no-op's lines are not even in the file: if processed it would throw
    // not-found and take the real sibling down with it. It must be skipped.
    const noop = chunk(['nonexistent anchor'], ['nonexistent anchor'])
    const real = chunk(['gamma'], ['GAMMA'])
    const notes: string[] = []
    const out = applyUpdateChunks(original, 'f.txt', [noop, real], notes)
    expect(out).toBe('alpha\nbeta\nGAMMA\n')
    expect(notes.some((n) => /skipped 1 no-op hunk/.test(n))).toBe(true)
  })

  it('keeps the clear not-found error when EVERY hunk is a no-op that cannot be located', () => {
    const original = 'alpha\nbeta\n'
    const noop = chunk(['nonexistent anchor'], ['nonexistent anchor'])
    expect(() => applyUpdateChunks(original, 'f.txt', [noop])).toThrow(
      /Failed to locate the context block/,
    )
  })
})

describe('buildUpdatedRegions', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

  it('echoes the changed region with line numbers and context', () => {
    const before = lines(10)
    const after = before.replace('line 5', 'LINE FIVE')
    const out = buildUpdatedRegions(before, after).text
    expect(out).toContain('5\tLINE FIVE')
    expect(out).toContain('3\tline 3') // 2 lines of leading context
    expect(out).toContain('7\tline 7') // 2 lines of trailing context
    expect(out).not.toContain('2\tline 2')
  })

  it('coalesces adjacent regions and separates distant ones with an ellipsis', () => {
    const before = lines(30)
    const after = before.replace('line 3', 'A').replace('line 25', 'B')
    const out = buildUpdatedRegions(before, after).text
    expect(out).toContain('…')
    expect(out).toContain('3\tA')
    expect(out).toContain('25\tB')
  })

  it('returns nothing when the edit is too large to echo cheaply', () => {
    expect(buildUpdatedRegions(lines(100), lines(100).replace(/line/g, 'L')).text).toBe('')
  })

  it('returns nothing when the content did not change', () => {
    expect(buildUpdatedRegions(lines(5), lines(5)).text).toBe('')
  })

  it('strips a BOM and CRLF so the echo is display-clean', () => {
    const before = '﻿a\r\nb\r\n'
    const after = '﻿a\r\nB\r\n'
    const out = buildUpdatedRegions(before, after).text
    expect(out).toContain('2\tB')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('﻿')
  })
})

describe('buildUpdatedRegions completeness', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

  it('a small file fully covered by the echo is marked complete', () => {
    const before = lines(5)
    const after = before.replace('line 3', 'line 3 CHANGED')
    expect(buildUpdatedRegions(before, after).complete).toBe(true)
  })

  it('a change in the middle of a long file is NOT complete', () => {
    // The echo shows ~5 lines of a 200-line file; claiming it "IS the file on disk"
    // taught the model the other 195 lines were gone.
    const before = lines(200)
    const after = before.replace('line 100', 'line 100 CHANGED')
    const out = buildUpdatedRegions(before, after)
    expect(out.text).toContain('line 100 CHANGED')
    expect(out.complete).toBe(false)
  })
})
