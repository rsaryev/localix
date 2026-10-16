import { describe, expect, test } from 'bun:test'
import { truncateHead, truncateTail, formatSize } from './truncate'

describe('formatSize', () => {
  test.each([
    [0, '0B'],
    [512, '512B'],
    [1023, '1023B'],
    [1024, '1.0KB'],
    [1536, '1.5KB'],
    [1024 * 1024 - 1, '1024.0KB'],
    [1024 * 1024, '1.0MB'],
    [2 * 1024 * 1024, '2.0MB'],
    [5 * 1024 * 1024, '5.0MB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected)
  })
})

describe('truncateHead', () => {
  test('no truncation when within limits', () => {
    const r = truncateHead('a\nb\nc')
    expect(r.truncated).toBe(false)
    expect(r.content).toBe('a\nb\nc')
  })

  test('truncates by line count, keeping the first N lines', () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const r = truncateHead(input, { maxLines: 3 })
    expect(r.truncated).toBe(true)
    expect(r.truncatedBy).toBe('lines')
    expect(r.content).toBe('line0\nline1\nline2')
    expect(r.outputLines).toBe(3)
  })

  test('truncates by byte count', () => {
    const input = Array.from({ length: 100 }, () => 'x'.repeat(10)).join('\n')
    const r = truncateHead(input, { maxBytes: 25 })
    expect(r.truncated).toBe(true)
    expect(r.truncatedBy).toBe('bytes')
    expect(r.outputBytes).toBeLessThanOrEqual(25)
  })

  test('first line exceeds byte limit', () => {
    const r = truncateHead('x'.repeat(1000) + '\nmore', { maxBytes: 10 })
    expect(r.firstLineExceedsLimit).toBe(true)
    expect(r.content).toBe('')
  })
})

describe('truncateTail', () => {
  test('keeps the last N lines (errors at end)', () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const r = truncateTail(input, { maxLines: 3 })
    expect(r.truncated).toBe(true)
    expect(r.content).toBe('line7\nline8\nline9')
  })

  test('partial last line when a single line exceeds byte limit', () => {
    const r = truncateTail('y'.repeat(1000), { maxBytes: 10 })
    expect(r.truncated).toBe(true)
    expect(r.lastLinePartial).toBe(true)
    expect(r.outputBytes).toBeLessThanOrEqual(10)
  })

  test('scans very large line sets while retaining only the bounded tail', () => {
    const input = `${Array.from({ length: 100_000 }, (_, i) => `discard-${i}`).join('\n')}\nkeep-a\nkeep-b\n`
    const r = truncateTail(input, { maxLines: 2, maxBytes: 100 })

    expect(r.content).toBe('keep-a\nkeep-b')
    expect(r.totalLines).toBe(100_002)
    expect(r.outputLines).toBe(2)
    expect(r.truncatedBy).toBe('lines')
  })
})

describe('line accounting compatibility', () => {
  test.each([
    ['', 0, 0],
    ['\n', 1, 1],
    ['a\n', 1, 1],
    ['a\nb', 2, 2],
    ['a\n\n', 2, 2],
  ])('matches head/tail split semantics for %j', (input, headLines, tailLines) => {
    expect(truncateHead(input).totalLines).toBe(headLines)
    expect(truncateTail(input).totalLines).toBe(tailLines)
  })
})

describe('utf8 safety', () => {
  test('multi-byte chars counted and not split (head bytes)', () => {
    // each emoji is 4 UTF-8 bytes
    const input = '😀😀😀😀😀'
    const r = truncateHead(input, { maxBytes: 10 })
    // single line: fits as one line if no newline truncation; byte path keeps whole line
    expect(r.totalBytes).toBe(20)
  })

  test('tail byte truncation does not split a multi-byte char', () => {
    const input = '😀'.repeat(10) // 40 bytes
    const r = truncateTail(input, { maxBytes: 10 })
    // 10 bytes / 4 bytes per emoji = 2 whole emoji (8 bytes)
    expect(r.outputBytes % 4).toBe(0)
    expect(r.content).not.toContain('�')
  })
})
