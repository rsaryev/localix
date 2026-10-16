import { afterEach, beforeEach, expect, test } from 'bun:test'
import { arrangePanels, hasFixedPanelLayout } from './arrangePanels'
import { emptyEditorState } from './persistence'
import { findLeaf, leaves, makeLeaf } from './tree'
import { groupOfTab, type EditorState } from './itemOps'
import { useGridStore } from './store'

const original = useGridStore.getState()
beforeEach(() => useGridStore.setState(emptyEditorState('root')))
afterEach(() => useGridStore.setState(original))

test('arranging keeps every tab and its metadata, including other conversations', () => {
  const items = {
    browser: { id: 'browser', kind: 'preview', title: 'Browser', scope: 's1' },
    terminal: { id: 'terminal', kind: 'terminal', title: 'Terminal', scope: 's1' },
    chat: { id: 'chat', kind: 'chat', title: 'Chat', scope: 's1' },
    file: { id: 'file', kind: 'file', title: 'Draft', scope: 's2', isDirty: true },
  }
  const state = {
    ...emptyEditorState('root'),
    items,
    root: {
      type: 'branch' as const,
      id: 'split',
      orientation: 'v' as const,
      sizes: [0.2, 0.8],
      children: [
        makeLeaf('browser-pane', ['browser', 'file'], 'browser', 'editor'),
        makeLeaf('terminal-pane', ['terminal', 'chat'], 'terminal'),
      ],
    },
    activeGroup: 'browser-pane',
    maximizedGroup: 'terminal-pane',
  }
  let seq = 0
  const next = arrangePanels(state, () => `new-${++seq}`)
  expect(next.items).toBe(items)
  expect(next.closed).toBe(state.closed)
  expect(next.maximizedGroup).toBeNull()
  expect(leaves(next.root).map((leaf) => leaf.role)).toEqual(['editor', 'aux'])
  expect(
    leaves(next.root)
      .flatMap((leaf) => leaf.tabs)
      .sort(),
  ).toEqual(Object.keys(items).sort())
  const editor = groupOfTab(next.root, 'browser')!
  expect(editor.id).toBe(groupOfTab(next.root, 'terminal')!.id)
  expect(next.activeGroup).toBe(editor.id)
  expect(new Set(leaves(next.root).map((leaf) => leaf.id)).size).toBe(2)
})

test('legacy stacked browser and terminal panels migrate to one primary column', () => {
  const state: EditorState = {
    ...emptyEditorState('root'),
    items: {
      a: { id: 'a', title: 'Browser', kind: 'preview', scope: 's1' },
      b: { id: 'b', title: 'Terminal', kind: 'terminal', scope: 's1' },
      c: { id: 'c', title: 'Chat', kind: 'chat', scope: 's1' },
    },
    root: {
      type: 'branch',
      id: 'split',
      orientation: 'v',
      sizes: [0.3, 0.4, 0.3],
      children: [
        makeLeaf('browser', ['a'], 'a', 'preview'),
        makeLeaf('terminal', ['b'], 'b', 'bottom'),
        makeLeaf('chat', ['c'], 'c', 'aux'),
      ],
    },
    activeGroup: 'terminal',
  }
  const next = arrangePanels(state, () => 'new')
  expect(hasFixedPanelLayout(state)).toBe(false)
  expect(hasFixedPanelLayout(next)).toBe(true)
  expect(leaves(next.root).map((leaf) => [leaf.role, leaf.tabs])).toEqual([
    ['editor', ['a', 'b']],
    ['aux', ['c']],
  ])
  expect(findLeaf(next.root, next.activeGroup)?.activeTab).toBe('b')
})

test('a valid two-column layout preserves its tab order and group identities', () => {
  const state: EditorState = {
    ...emptyEditorState('root'),
    items: {
      a: { id: 'a', title: 'A', kind: 'file', scope: 's1' },
      b: { id: 'b', title: 'B', kind: 'terminal', scope: 's1' },
      c: { id: 'c', title: 'C', kind: 'chat', scope: 's1' },
    },
    root: {
      type: 'branch',
      id: 'split',
      orientation: 'h',
      sizes: [0.62, 0.38],
      children: [makeLeaf('editor', ['b', 'a'], 'b', 'editor'), makeLeaf('aux', ['c'], 'c', 'aux')],
    },
    activeGroup: 'editor',
  }
  expect(hasFixedPanelLayout(state)).toBe(true)
  const next = arrangePanels(state, () => {
    throw new Error('No group should be minted')
  })
  expect(leaves(next.root).map((leaf) => [leaf.id, leaf.tabs, leaf.activeTab])).toEqual([
    ['editor', ['b', 'a'], 'b'],
    ['aux', ['c'], 'c'],
  ])
})

test('migration retains activation history so closing the active tab returns to the prior tab', () => {
  const leaf = {
    ...makeLeaf('editor', ['a', 'b', 'c'], 'a', 'editor'),
    tabHistory: ['a', 'c', 'b'],
  }
  const state: EditorState = {
    ...emptyEditorState('editor'),
    root: leaf,
    activeGroup: leaf.id,
    items: Object.fromEntries(
      ['a', 'b', 'c'].map((id) => [
        id,
        {
          id,
          title: id,
          kind: 'file',
          scope: 's1',
        },
      ]),
    ),
  }
  useGridStore.setState({ ...arrangePanels(state, () => 'aux'), activeScope: 's1' })
  const grid = useGridStore.getState()
  grid.closeTab(grid.activeGroup, 'a')
  expect(findLeaf(useGridStore.getState().root, 'editor')?.activeTab).toBe('c')
})

test('arranging preserves a hidden conversation remembered tab when returning to that scope', () => {
  const state = {
    ...emptyEditorState('editor'),
    root: makeLeaf(
      'editor',
      ['background-focused', 'background-last', 'visible'],
      'visible',
      'editor',
    ),
    activeGroup: 'editor',
    activeScope: 's1',
    warmScopes: ['s2'],
    scopeActiveTab: {
      s1: { editor: ['visible'] },
      s2: { editor: ['background-focused', 'background-last'] },
    },
    items: {
      visible: { id: 'visible', kind: 'file', title: 'Visible', scope: 's1' },
      'background-focused': {
        id: 'background-focused',
        kind: 'file',
        title: 'Focused',
        scope: 's2',
      },
      'background-last': { id: 'background-last', kind: 'file', title: 'Last', scope: 's2' },
    },
  }
  useGridStore.setState(state)
  useGridStore.getState().arrangePanels()
  const next = useGridStore.getState()
  const group = groupOfTab(next.root, 'background-focused')!
  expect(next.scopeActiveTab.s2?.[group.id]?.[0]).toBe('background-focused')
  expect(next.warmScopes).toEqual(['s2'])
})
