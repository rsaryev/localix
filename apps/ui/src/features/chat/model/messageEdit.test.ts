import { describe, expect, test } from 'bun:test'

import {
  initialEditState,
  enterEdit,
  cancelEdit,
  confirmEdit,
  shouldPersistEdit,
  type EditState,
} from './messageEdit'

const enterParams = {
  sessionId: 's1',
  messageId: 'm1',
  originalText: 'hello world',
  currentDraft: 'half-typed draft',
}

describe('messageEdit reducer', () => {
  test('enter stashes the current draft and loads the message text', () => {
    const t = enterEdit(initialEditState, enterParams)
    expect(t.state.editing).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      originalText: 'hello world',
    })
    expect(t.state.stashedDraft).toBe('half-typed draft')
    expect(t.composerText).toBe('hello world')
  })

  test('cancel restores the stashed draft and clears edit state', () => {
    const entered = enterEdit(initialEditState, enterParams).state
    const t = cancelEdit(entered)
    expect(t.state).toEqual(initialEditState)
    expect(t.composerText).toBe('half-typed draft')
  })

  test('confirm clears edit state and restores the stashed draft (like cancel)', () => {
    const entered = enterEdit(initialEditState, enterParams).state
    const t = confirmEdit(entered)
    expect(t.state).toEqual(initialEditState)
    expect(t.composerText).toBe('half-typed draft')
  })

  test('empty stashed draft restores to empty on cancel', () => {
    const entered = enterEdit(initialEditState, { ...enterParams, currentDraft: '' }).state
    expect(cancelEdit(entered).composerText).toBe('')
  })

  test('re-entering edit on another message keeps the ORIGINAL stash', () => {
    const first = enterEdit(initialEditState, enterParams).state
    // The composer now holds "hello world"; the user clicks Edit on another message.
    const second = enterEdit(first, {
      sessionId: 's1',
      messageId: 'm2',
      originalText: 'second message',
      currentDraft: 'hello world', // what's in the box right now (the first message)
    })
    expect(second.state.editing?.messageId).toBe('m2')
    // The displaced draft must still be the pre-edit one, not the first message text.
    expect(second.state.stashedDraft).toBe('half-typed draft')
    expect(second.composerText).toBe('second message')
    // Cancelling now returns to the genuine pre-edit draft.
    expect(cancelEdit(second.state).composerText).toBe('half-typed draft')
  })

  test('shouldPersistEdit: only non-empty, changed text persists', () => {
    const editing = { sessionId: 's1', messageId: 'm1', originalText: 'hello world' }
    expect(shouldPersistEdit(editing, 'hello world')).toBe(false) // unchanged
    expect(shouldPersistEdit(editing, '  hello world  ')).toBe(false) // unchanged (trim)
    expect(shouldPersistEdit(editing, '')).toBe(false) // empty
    expect(shouldPersistEdit(editing, '   ')).toBe(false) // blank
    expect(shouldPersistEdit(editing, 'hello there')).toBe(true) // changed
  })

  test('idle state carried by initialEditState', () => {
    const s: EditState = initialEditState
    expect(s.editing).toBeNull()
    expect(s.stashedDraft).toBe('')
  })
})
