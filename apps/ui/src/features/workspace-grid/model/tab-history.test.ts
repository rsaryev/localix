import { expect, test } from 'bun:test'

import {
  MAX_CLOSED,
  closeTabState,
  openItemState,
  reopenClosedTabState,
  type EditorState,
} from './itemOps'
import { makeLeaf } from './tree'

function emptyState(): EditorState {
  return {
    root: makeLeaf('group'),
    items: {},
    activeGroup: 'group',
    mru: ['group'],
    maximizedGroup: null,
    closed: [],
  }
}

test('reopening keeps only the newest closed tabs and consumes them in reverse closing order', () => {
  let state = emptyState()
  for (let i = 0; i < MAX_CLOSED + 3; i++) {
    const id = `file:${i}`
    state = openItemState(state, { id, kind: 'file', title: String(i) })
    state = closeTabState(state, 'group', id)
  }
  expect(state.closed).toHaveLength(MAX_CLOSED)
  expect(state.closed[0]?.item.id).toBe('file:3')
  for (let i = MAX_CLOSED + 2; i >= 3; i--) {
    state = reopenClosedTabState(state)
    expect(state.root.type === 'leaf' && state.root.activeTab).toBe(`file:${i}`)
  }
  expect(state.closed).toEqual([])
  expect(reopenClosedTabState(state)).toBe(state)
})

test('closing a preview retains the existing reopen stack by identity', () => {
  let state = openItemState(emptyState(), { id: 'file:kept', kind: 'file', title: 'Kept' })
  state = closeTabState(state, 'group', 'file:kept')
  const closed = state.closed
  state = openItemState(
    state,
    { id: 'file:preview', kind: 'file', title: 'Preview' },
    { ephemeral: true },
  )
  state = closeTabState(state, 'group', 'file:preview')
  expect(state.closed).toBe(closed)
  const reopened = reopenClosedTabState(state)
  expect(reopened.items['file:kept']?.title).toBe('Kept')
  expect(reopened.items['file:preview']).toBeUndefined()
})
