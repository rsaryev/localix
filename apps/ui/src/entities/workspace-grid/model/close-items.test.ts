import { expect, test } from 'bun:test'

import {
  closeTabState,
  openItemState,
  reopenClosedTabState,
  splitState,
  type EditorState,
} from './itemOps'
import { findLeaf, makeLeaf } from './tree'

test('a closed tab whose original group collapsed reopens in the surviving active group', () => {
  let state: EditorState = {
    root: makeLeaf('original'),
    items: {},
    activeGroup: 'original',
    mru: ['original'],
    maximizedGroup: null,
    closed: [],
  }
  state = openItemState(state, { id: 'file:a', kind: 'file', title: 'A', scope: 'A' })
  state = splitState(state, 'original', 'right', 'survivor')
  state = openItemState(state, { id: 'file:b', kind: 'file', title: 'B', scope: 'B' })
  state = closeTabState(state, 'original', 'file:a')
  expect(findLeaf(state.root, 'original')).toBeNull()
  expect(state.closed[0]?.group).toBe('original')
  const reopened = reopenClosedTabState(state)
  expect(findLeaf(reopened.root, 'survivor')?.tabs).toEqual(['file:b', 'file:a'])
  expect(findLeaf(reopened.root, 'survivor')?.activeTab).toBe('file:a')
  expect(reopened.items['file:a']?.scope).toBe('A')
  expect(reopened.activeGroup).toBe('survivor')
  expect(reopened.closed).toEqual([])
  expect(state.closed).toHaveLength(1)
})
