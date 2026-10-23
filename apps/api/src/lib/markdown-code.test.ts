import { describe, expect, test } from 'bun:test'

import { codeSpanRanges, createFenceTracker, insideAnyRange } from './markdown-code'

describe('codeSpanRanges', () => {
  test('pairs backtick runs of the same length', () => {
    const line = 'use `@a` and ``@b ` c`` but not @d'
    const ranges = codeSpanRanges(line)
    expect(ranges).toEqual([
      [4, 8],
      [13, 23],
    ])
    expect(insideAnyRange(line.indexOf('@a'), ranges)).toBe(true)
    expect(insideAnyRange(line.indexOf('@b'), ranges)).toBe(true)
    expect(insideAnyRange(line.indexOf('@d'), ranges)).toBe(false)
  })

  test('an unclosed run opens no span', () => {
    expect(codeSpanRanges('a ` b @c')).toEqual([])
  })
})

describe('createFenceTracker', () => {
  test('fence lines and the lines between them are code', () => {
    const inFence = createFenceTracker()
    const lines = ['before', '```ts', '@inside', '```', 'after']
    expect(lines.map(inFence)).toEqual([false, true, true, true, false])
  })

  test('a block closes only on the marker kind that opened it', () => {
    const inFence = createFenceTracker()
    const lines = ['~~~', '```', '@still-inside', '~~~~', 'after']
    expect(lines.map(inFence)).toEqual([true, true, true, true, false])
  })
})
