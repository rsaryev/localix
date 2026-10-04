import { describe, expect, test } from 'bun:test'
import { createUndoTokens } from './undoTokens'

describe('undo tokens', () => {
  test('only the newest change may be undone from its row', () => {
    const tokens = createUndoTokens()
    const rename = tokens.record()
    const move = tokens.record()
    // The bug: the rename row's Undo reversed the move. Now it is refused.
    expect(tokens.isLatest(rename)).toBe(false)
    expect(tokens.isLatest(move)).toBe(true)
  })

  test('a change without a row still counts, so an older row cannot reach past it', () => {
    const tokens = createUndoTokens()
    const trashed = tokens.record()
    tokens.record() // a batch move to Trash: journaled on the server, no row here
    expect(tokens.isLatest(trashed)).toBe(false)
  })

  test('undoing the newest change makes the one before it undoable again', () => {
    const tokens = createUndoTokens()
    const first = tokens.record()
    tokens.record()
    tokens.popped() // ⌘Z reversed the second change
    expect(tokens.isLatest(first)).toBe(true)
  })

  test('an emptied server journal leaves nothing undoable', () => {
    const tokens = createUndoTokens()
    const only = tokens.record()
    tokens.cleared()
    expect(tokens.isLatest(only)).toBe(false)
  })
})
