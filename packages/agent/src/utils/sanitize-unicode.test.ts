import { describe, expect, test } from 'bun:test'
import { sanitizeSurrogates } from './sanitize-unicode'

describe('sanitizeSurrogates', () => {
  test('preserves valid BMP text and surrogate pairs', () => {
    expect(sanitizeSurrogates('Hello 🙈 café')).toBe('Hello 🙈 café')
  })

  test('removes lone high and low surrogates', () => {
    expect(sanitizeSurrogates(`a\ud83db\udc00c`)).toBe('abc')
  })

  test('keeps a valid pair surrounded by malformed code units', () => {
    expect(sanitizeSurrogates(`\ud83d🙈\udc00`)).toBe('🙈')
  })
})
