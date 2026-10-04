import { describe, expect, test } from 'bun:test'
import { externalLineChanges } from './externalChanges'

describe('externalLineChanges — which lines an external write changed', () => {
  test('an unchanged file marks nothing', () => {
    expect(externalLineChanges('a\nb\n', 'a\nb\n')).toEqual([])
  })

  test('an edited line is marked modified, in the NEW text coordinates', () => {
    expect(externalLineChanges('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { fromLine: 2, toLine: 2, type: 'modified' },
    ])
  })

  test('separate hunks stay separate — not one span from first to last change', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n')
    const after = ['1', 'two', '3', '4', '5', '6', 'seven', '8'].join('\n')
    expect(externalLineChanges(before, after)).toEqual([
      { fromLine: 2, toLine: 2, type: 'modified' },
      { fromLine: 7, toLine: 7, type: 'modified' },
    ])
  })

  test('insertions and deletions are told apart', () => {
    expect(externalLineChanges('a\nc\n', 'a\nb\nc\n')).toEqual([
      { fromLine: 2, toLine: 2, type: 'added' },
    ])
    expect(externalLineChanges('a\nb\nc\n', 'a\nc\n')[0]?.type).toBe('deleted')
  })

  test('a trailing-newline-only difference is not a change', () => {
    expect(externalLineChanges('a\nb', 'a\nb\n')).toEqual([])
  })
})
