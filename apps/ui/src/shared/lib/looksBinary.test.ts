import { describe, expect, test } from 'bun:test'
import { looksBinary } from './looksBinary'

describe('looksBinary', () => {
  test('plain source/text is not binary', () => {
    expect(looksBinary('export const x = 1\n')).toBe(false)
    expect(looksBinary('# Heading\n\nsome prose with punctuation, 123.')).toBe(false)
  })

  test('an empty string is not binary', () => {
    expect(looksBinary('')).toBe(false)
  })

  test('a NUL byte is always binary', () => {
    expect(looksBinary('abc\u0000def')).toBe(true)
  })

  test('a dense run of replacement chars (botched UTF-8 decode) is binary', () => {
    // >10% U+FFFD over the sample window
    expect(looksBinary('�'.repeat(50) + 'abc')).toBe(true)
  })

  test('a few stray replacement chars below the threshold are tolerated', () => {
    // 2 bad chars in ~100 = 2% < 10%
    expect(looksBinary('a'.repeat(98) + '��')).toBe(false)
  })

  test('only the first 2000 chars are sampled (a clean head passes despite a dirty tail)', () => {
    expect(looksBinary('a'.repeat(2000) + '�'.repeat(500))).toBe(false)
  })
})
