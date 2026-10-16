import { describe, expect, test } from 'bun:test'

import { estimateTokens } from './tokens'

describe('estimateTokens', () => {
  test('keeps ASCII bytes/4 behavior', () => {
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  test('uses UTF-8 bytes for multilingual text', () => {
    expect(estimateTokens('你好🙂')).toBe(3)
  })
})
