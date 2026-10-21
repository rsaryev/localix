import { describe, expect, it } from 'bun:test'

import { countEditChanges, countLines, countPatchChanges } from './liveCode'

// The counting logic (edge cases, header skipping, partial-object tolerance) is owned +
// exhaustively tested by the shared `@localixai/api/item-format` leaf. What this module owns
// is the ADAPTER: the leaf's `{ added, removed }` renamed to the web card's `{ additions,
// deletions }`. These tests pin that boundary, not the arithmetic.
describe('countLines (leaf pass-through)', () => {
  it('returns the leaf line count as a plain number', () => {
    expect(countLines(undefined)).toBe(0)
    expect(countLines('one line')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
  })
})

describe('countEditChanges (leaf → web vocabulary)', () => {
  it('adapts the leaf counts into { additions, deletions }', () => {
    const edits = [
      { old_string: 'a\nb', new_string: 'x\ny\nz' },
      { old_string: 'c', new_string: 'q' },
    ]
    expect(countEditChanges(edits)).toEqual({ additions: 4, deletions: 3 })
  })
})

describe('countPatchChanges (leaf → web vocabulary)', () => {
  it('adapts the leaf counts into { additions, deletions }', () => {
    const patch = [
      '*** Update File: a.ts',
      '--- a.ts',
      '+++ b.ts',
      '+added',
      '-removed',
      ' context',
    ].join('\n')
    expect(countPatchChanges(patch)).toEqual({ additions: 1, deletions: 1 })
  })
})
