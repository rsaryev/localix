import { expect, test } from 'bun:test'

import { MAX_FILE_TABS, openItemState, type EditorState } from './itemOps'
import { findLeaf, makeLeaf } from './tree'

test('background opens at the file cap retain the active oldest file and evict the next oldest', () => {
  let state: EditorState = {
    root: makeLeaf('group'),
    items: {},
    activeGroup: 'group',
    mru: ['group'],
    maximizedGroup: null,
    closed: [],
  }
  for (let i = 0; i <= MAX_FILE_TABS; i++) {
    state = openItemState(
      state,
      { id: `file:${i}`, kind: 'file', title: String(i) },
      { activate: i === 0 },
    )
  }
  const leaf = findLeaf(state.root, 'group')!
  expect(leaf.tabs).toHaveLength(MAX_FILE_TABS)
  expect(leaf.activeTab).toBe('file:0')
  expect(state.items['file:0']).toBeDefined()
  expect(state.items['file:1']).toBeUndefined()
  expect(state.items[`file:${MAX_FILE_TABS}`]).toBeDefined()
  expect(state.closed).toEqual([])
})
