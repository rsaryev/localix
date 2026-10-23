import { describe, expect, test } from 'bun:test'

import { mergeLogSnapshots } from './logStream'

describe('runtime log snapshot merge', () => {
  test('removes only the replayed suffix/prefix overlap', () => {
    expect(mergeLogSnapshots('a\nb\nb', 'b\nb\nc')).toBe('a\nb\nb\nc')
  })

  test('appends a disjoint page and keeps the newest bounded lines', () => {
    expect(mergeLogSnapshots('a\nb', 'c\nd', 3)).toBe('b\nc\nd')
  })

  test('keeps the previous snapshot when an incremental read is empty', () => {
    expect(mergeLogSnapshots('a\nb', '')).toBe('a\nb')
  })
})
