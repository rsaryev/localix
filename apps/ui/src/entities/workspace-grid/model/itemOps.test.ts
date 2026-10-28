import { describe, expect, test } from 'bun:test'
import type { WorkItem } from '@/shared/lib/workItem'
import {
  type EditorState,
  MAX_FILE_TABS,
  MAX_TAB_HISTORY,
  groupOfTab,
  openItemState,
  closeTabState,
  closeTabsState,
  moveTabState,
  splitState,
  setActiveGroupState,
  setActiveTabState,
  reorderTabState,
  maximizeState,
  resolveRoleGroupState,
  closeScopeState,
  setTabTitleState,
  setItemDirtyState,
  setItemAttention,
} from './itemOps'
import { makeLeaf, leafIds, findLeaf, findLeafByRole } from './tree'

const base = (): EditorState => ({
  root: makeLeaf('g1'),
  items: {},
  activeGroup: 'g1',
  mru: ['g1'],
  maximizedGroup: null,
  closed: [],
})

const file = (path: string, ephemeral?: boolean): WorkItem => ({
  kind: 'file',
  id: `file:${path}`,
  title: path,
  ...(ephemeral !== undefined ? { ephemeral } : {}),
})
const term = (): WorkItem => ({ kind: 'terminal', id: 'terminal', title: 'Terminal' })

describe('openItemState', () => {
  test('adds a tab to the active group and activates it', () => {
    const s = openItemState(base(), file('a.ts'))
    const g = findLeaf(s.root, 'g1')!
    expect(g.tabs).toEqual(['file:a.ts'])
    expect(g.activeTab).toBe('file:a.ts')
    expect(s.items['file:a.ts'].title).toBe('a.ts')
  })

  test('re-opening an existing id reveals it, never duplicates', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('a.ts')) // reveal
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts', 'file:b.ts'])
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
  })

  test('singleton revealed in whichever group already holds it', () => {
    let s = openItemState(base(), term())
    s = splitState(s, 'g1', 'right', 'g2') // empty g2, active
    s = openItemState(s, term()) // terminal already in g1 → reveal there
    expect(groupOfTab(s.root, 'terminal')?.id).toBe('g1')
    expect(s.activeGroup).toBe('g1')
  })

  test('ephemeral open reuses the group preview slot', () => {
    let s = openItemState(base(), file('a.ts'), { ephemeral: true })
    s = openItemState(s, file('b.ts'), { ephemeral: true }) // replaces the slot
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:b.ts'])
  })

  test('a pinned file is not replaced by a later ephemeral open of it', () => {
    let s = openItemState(base(), file('a.ts', false)) // pinned
    s = openItemState(s, file('a.ts', true)) // would-be ephemeral
    expect(s.items['file:a.ts'].ephemeral).toBe(false)
  })

  test('file-tab cap evicts the oldest non-active file', () => {
    let s = base()
    for (let i = 0; i < MAX_FILE_TABS + 3; i++) s = openItemState(s, file(`f${i}.ts`))
    const fileTabs = findLeaf(s.root, 'g1')!.tabs.filter((id) => id.startsWith('file:'))
    expect(fileTabs.length).toBe(MAX_FILE_TABS)
    expect(s.items[`file:f0.ts`]).toBeUndefined() // oldest evicted
  })

  test('activate:false adds without stealing focus', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'), { activate: false })
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
  })
})

describe('closeTabState', () => {
  test('removes a tab and re-picks a neighbour as active', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = closeTabState(s, 'g1', 'file:b.ts')
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts'])
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
    expect(s.items['file:b.ts']).toBeUndefined()
  })

  test('closing the last tab of a non-last group removes the group', () => {
    let s = openItemState(base(), file('a.ts'))
    s = splitState(s, 'g1', 'right', 'g2', 'file:a.ts') // move a.ts into g2
    // g1 is now empty, g2 has a.ts. Close a.ts → g2 removed, collapse to g1.
    s = closeTabState(s, 'g2', 'file:a.ts')
    expect(leafIds(s.root)).toEqual(['g1'])
  })

  test('closing the only tab of the only group empties it (keeps the group)', () => {
    let s = openItemState(base(), file('a.ts'))
    s = closeTabState(s, 'g1', 'file:a.ts')
    expect(leafIds(s.root)).toEqual(['g1'])
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual([])
  })

  test('scope-aware: closing the active chat picks a same-scope survivor, not a hidden cross-scope tab', () => {
    const chat = (scope: string): WorkItem => ({
      kind: 'chat',
      id: `chat:${scope}`,
      title: scope,
      scope,
      payload: { sessionId: scope },
    })
    const scopedFile = (scope: string): WorkItem => ({
      kind: 'file',
      id: `file:${scope}:a.ts`,
      title: 'a.ts',
      scope,
    })
    let s = openItemState(base(), chat('A')) // chat:A (scope A)
    s = openItemState(s, chat('B')) // chat:B (scope B) — hidden under scope A
    s = openItemState(s, scopedFile('A')) // file (scope A)
    s = setActiveTabState(s, 'g1', 'chat:A')
    // Close the active scope-A chat WHILE scope A is active. The positional pick
    // would promote the adjacent hidden chat:B; the scope-aware pick must land on
    // the visible scope-A file instead (so closing chat never "switches" session).
    s = closeTabState(s, 'g1', 'chat:A', 'A')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:A:a.ts')
  })

  test('without an active scope, the next-active pick stays positional (adjacent tab)', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = setActiveTabState(s, 'g1', 'file:a.ts')
    s = closeTabState(s, 'g1', 'file:a.ts') // no activeScope arg → positional
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:b.ts')
  })
})

describe('closeTabsState (batch — Close Others / Close All)', () => {
  const abc = (): EditorState => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    return openItemState(s, file('c.ts')) // tabs [a,b,c], active c
  }

  test('closes a subset, keeping the rest (the group survives) + pushes them to reopen', () => {
    const s = closeTabsState(abc(), 'g1', ['file:a.ts', 'file:b.ts'])
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:c.ts'])
    expect(s.items['file:a.ts']).toBeUndefined()
    expect(s.items['file:b.ts']).toBeUndefined()
    expect(s.closed.map((c) => c.item.id)).toEqual(['file:a.ts', 'file:b.ts']) // tab order
  })

  test('keeps the active tab when it is not among those closed', () => {
    const s = closeTabsState(abc(), 'g1', ['file:a.ts']) // active is c
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:c.ts')
  })

  test('re-points the active tab to a survivor when the active one is closed', () => {
    const s = closeTabsState(abc(), 'g1', ['file:b.ts', 'file:c.ts']) // c is active
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts'])
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
  })

  test('closing every tab of a non-last group collapses it', () => {
    let s = openItemState(base(), file('a.ts'))
    s = splitState(s, 'g1', 'right', 'g2') // empty g2, active
    s = openItemState(s, file('b.ts')) // b → g2
    s = openItemState(s, file('c.ts')) // c → g2 (tabs [b,c])
    s = closeTabsState(s, 'g2', ['file:b.ts', 'file:c.ts'])
    expect(leafIds(s.root)).toEqual(['g1'])
  })

  test('no-op (same ref) when no id matches or the group is absent', () => {
    const s = abc()
    expect(closeTabsState(s, 'g1', ['file:zzz.ts'])).toBe(s) // none present
    expect(closeTabsState(s, 'g1', [])).toBe(s) // empty set
    expect(closeTabsState(s, 'gX', ['file:a.ts'])).toBe(s) // group absent
  })
})

describe('splitState / moveTabState', () => {
  test('split moves the named tab into a fresh sibling group', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = splitState(s, 'g1', 'right', 'g2', 'file:b.ts')
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts'])
    expect(findLeaf(s.root, 'g2')!.tabs).toEqual(['file:b.ts'])
    expect(s.activeGroup).toBe('g2')
  })

  test('moveTab relocates a tab between groups', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = splitState(s, 'g1', 'right', 'g2') // empty g2
    s = moveTabState(s, 'file:a.ts', 'g2')
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:b.ts'])
    expect(findLeaf(s.root, 'g2')!.tabs).toEqual(['file:a.ts'])
  })

  test('moving the last tab out collapses the source group', () => {
    let s = openItemState(base(), file('a.ts'))
    s = splitState(s, 'g1', 'right', 'g2') // g1=[a], g2=[]
    s = moveTabState(s, 'file:a.ts', 'g2') // g1 empties → removed
    expect(leafIds(s.root)).toEqual(['g2'])
  })

  test('moveTab within a group reorders to index', () => {
    let s = base()
    s = openItemState(s, file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('c.ts'))
    s = moveTabState(s, 'file:c.ts', 'g1', 0)
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:c.ts', 'file:a.ts', 'file:b.ts'])
  })

  test('split inherits the source group role (a split of the editor is another editor)', () => {
    const s: EditorState = {
      ...base(),
      root: makeLeaf('ed', ['file:a.ts'], 'file:a.ts', 'editor'),
      items: { 'file:a.ts': file('a.ts') },
      activeGroup: 'ed',
    }
    const r = splitState(s, 'ed', 'right', 'ed2', 'file:a.ts')
    expect(findLeaf(r.root, 'ed')?.role).toBe('editor')
    expect(findLeaf(r.root, 'ed2')?.role).toBe('editor') // inherited, not undefined
  })

  test('same-group move to the position a tab already holds is a no-op (same ref)', () => {
    let s = base()
    s = openItemState(s, file('a.ts'))
    s = openItemState(s, file('b.ts'))
    // 'b' is already last → moving it to the end (center-drop on its own group)
    // must not rebuild the tree.
    expect(moveTabState(s, 'file:b.ts', 'g1')).toBe(s)
    expect(moveTabState(s, 'file:a.ts', 'g1', 0)).toBe(s)
  })
})

describe('active + reorder + maximize', () => {
  test('setActiveGroup / setActiveTab update focus + mru', () => {
    let s = openItemState(base(), file('a.ts'))
    s = splitState(s, 'g1', 'right', 'g2')
    s = setActiveGroupState(s, 'g1')
    expect(s.activeGroup).toBe('g1')
    expect(s.mru[0]).toBe('g1')
    s = setActiveTabState(s, 'g1', 'file:a.ts')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
  })

  test('setActiveTab focuses a non-active group on its own (no separate setActiveGroup needed)', () => {
    let s = openItemState(base(), file('a.ts')) // g1 holds a.ts
    s = splitState(s, 'g1', 'right', 'g2') // g2 is now the active/focused group
    expect(s.activeGroup).toBe('g2')
    // Activating a tab in g1 WITHOUT a preceding setActiveGroup must focus g1 —
    // the invariant that lets callers drop a redundant setActiveGroup before it.
    s = setActiveTabState(s, 'g1', 'file:a.ts')
    expect(s.activeGroup).toBe('g1')
    expect(s.mru[0]).toBe('g1')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
  })

  test('re-selecting the already-active tab/group is a no-op (same ref)', () => {
    let s = openItemState(base(), file('a.ts')) // g1 focused, a.ts active
    expect(setActiveGroupState(s, 'g1')).toBe(s) // already focused + MRU-front
    expect(setActiveTabState(s, 'g1', 'file:a.ts')).toBe(s) // already active tab
    // But it DOES re-focus when the group isn't the active one.
    s = splitState(s, 'g1', 'right', 'g2') // g2 now active
    expect(setActiveGroupState(s, 'g1')).not.toBe(s)
  })

  test('reorderTab moves within the group (null = end)', () => {
    let s = base()
    s = openItemState(s, file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = reorderTabState(s, 'g1', 'file:a.ts', null)
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:b.ts', 'file:a.ts'])
  })

  test('reorderTab onto the slot it already occupies is a no-op (same ref)', () => {
    let s = base()
    s = openItemState(s, file('a.ts'))
    s = openItemState(s, file('b.ts')) // tabs: ['file:a.ts', 'file:b.ts']
    // Dropping the last tab "at end", or a tab right before the sibling it already
    // precedes, leaves the order identical — must not rebuild the tree / re-persist.
    expect(reorderTabState(s, 'g1', 'file:b.ts', null)).toBe(s)
    expect(reorderTabState(s, 'g1', 'file:a.ts', 'file:b.ts')).toBe(s)
    // A genuine reorder still produces a new state.
    expect(reorderTabState(s, 'g1', 'file:a.ts', null)).not.toBe(s)
  })

  test('setTabTitle renames a tab in place; no-op (same ref) when absent or unchanged', () => {
    const s = openItemState(base(), file('a.ts'))
    const renamed = setTabTitleState(s, 'file:a.ts', 'My File')
    expect(renamed.items['file:a.ts'].title).toBe('My File')
    expect(setTabTitleState(renamed, 'file:a.ts', 'My File')).toBe(renamed) // unchanged
    expect(setTabTitleState(s, 'file:missing', 'X')).toBe(s) // absent
  })

  test('setItemDirty flips the dirty dot; no-op (same ref) when unchanged or absent', () => {
    const s = openItemState(base(), file('a.ts'))
    expect(s.items['file:a.ts'].isDirty).toBeUndefined()
    const dirty = setItemDirtyState(s, 'file:a.ts', true)
    expect(dirty.items['file:a.ts'].isDirty).toBe(true)
    expect(setItemDirtyState(dirty, 'file:a.ts', true)).toBe(dirty) // unchanged
    const clean = setItemDirtyState(dirty, 'file:a.ts', false)
    expect(clean.items['file:a.ts'].isDirty).toBeUndefined() // cleared, not false
    expect(setItemDirtyState(s, 'file:a.ts', false)).toBe(s) // already clean
    expect(setItemDirtyState(s, 'file:missing', true)).toBe(s) // absent
  })

  test('editing a preview tab pins it permanently, so a later click cannot take its slot', () => {
    // A dirty editor is always pinned. Guarding replacement on `isDirty` alone would only protect
    // the tab until it is saved.
    const opened = openItemState(base(), file('a.ts'), { replace: true })
    expect(opened.items['file:a.ts'].ephemeral).toBe(true)

    const edited = setItemDirtyState(opened, 'file:a.ts', true)
    expect(edited.items['file:a.ts'].ephemeral).toBe(false)

    const saved = setItemDirtyState(edited, 'file:a.ts', false)
    expect(saved.items['file:a.ts'].isDirty).toBeUndefined()
    expect(saved.items['file:a.ts'].ephemeral).toBe(false) // still pinned after saving

    const next = openItemState(saved, file('b.ts'), { replace: true })
    expect(Object.keys(next.items).sort()).toEqual(['file:a.ts', 'file:b.ts'])
  })

  test('setItemAttention flips the activity dot; no-op (same ref) when unchanged or absent', () => {
    const s = openItemState(base(), file('a.ts'))
    expect(s.items['file:a.ts'].attention).toBeUndefined()
    const on = setItemAttention(s, 'file:a.ts', true)
    expect(on.items['file:a.ts'].attention).toBe(true)
    expect(setItemAttention(on, 'file:a.ts', true)).toBe(on) // unchanged
    const off = setItemAttention(on, 'file:a.ts', false)
    expect(off.items['file:a.ts'].attention).toBeUndefined() // cleared, not false
    expect(setItemAttention(s, 'file:a.ts', false)).toBe(s) // already clear
    expect(setItemAttention(s, 'file:missing', true)).toBe(s) // absent
  })

  test('maximize toggles', () => {
    let s = openItemState(base(), file('a.ts'))
    s = maximizeState(s, 'g1')
    expect(s.maximizedGroup).toBe('g1')
    s = maximizeState(s, 'g1')
    expect(s.maximizedGroup).toBeNull()
  })

  test('opening a tab into a different group clears an active maximize (stays visible)', () => {
    let s = openItemState(base(), file('a.ts'))
    s = splitState(s, 'g1', 'right', 'g2') // g2 active+empty
    s = maximizeState(s, 'g1') // maximize g1
    expect(s.maximizedGroup).toBe('g1')
    s = openItemState(s, file('b.ts'), { group: 'g2' }) // open into the hidden g2
    expect(s.maximizedGroup).toBeNull() // un-maximized so b.ts is visible
    expect(findLeaf(s.root, 'g2')!.tabs).toEqual(['file:b.ts'])
  })

  test('opening a tab into the maximized group keeps the maximize', () => {
    let s = openItemState(base(), file('a.ts'))
    s = maximizeState(s, 'g1')
    s = openItemState(s, file('b.ts'), { group: 'g1' })
    expect(s.maximizedGroup).toBe('g1')
  })

  test('splitting while maximized clears the maximize (new group visible)', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = maximizeState(s, 'g1')
    s = splitState(s, 'g1', 'right', 'g2', 'file:b.ts') // Split Right via menu
    expect(s.maximizedGroup).toBeNull()
    expect(findLeaf(s.root, 'g2')!.tabs).toEqual(['file:b.ts'])
  })

  test('moving a tab to another group while maximized clears the maximize', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = splitState(s, 'g1', 'right', 'g2') // also clears maximize (none set yet)
    s = maximizeState(s, 'g2')
    s = moveTabState(s, 'file:a.ts', 'g2') // into the maximized group → keep
    expect(s.maximizedGroup).toBe('g2') // g1=[b], g2=[a]
    s = maximizeState(s, 'g1') // maximize g1 (holds b.ts)
    s = moveTabState(s, 'file:b.ts', 'g2') // move OUT of maximized g1 → clears
    expect(s.maximizedGroup).toBeNull()
  })
})

describe('resolveRoleGroupState', () => {
  const ids = () => {
    let n = 0
    return () => `g${n++}`
  }

  test('reuses an existing role group WITHOUT allocating new state (perf invariant)', () => {
    // A chat root + a role-tagged editor group already present.
    const s: EditorState = {
      ...base(),
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        sizes: [0.4, 0.6],
        children: [
          makeLeaf('chat', ['chat:s1'], 'chat:s1', 'aux'),
          makeLeaf('ed', ['file:a.ts'], 'file:a.ts', 'editor'),
        ],
      },
      items: {
        'chat:s1': { kind: 'chat', id: 'chat:s1', title: 'Chat' },
        'file:a.ts': file('a.ts'),
      },
      activeGroup: 'ed',
    }
    const r = resolveRoleGroupState(s, 'file', ids())
    expect(r.groupId).toBe('ed')
    expect(r.state).toBe(s) // same reference → store skips the no-op set/persist
  })

  test('adopts an existing untagged group whose content implies the role (migration)', () => {
    const s: EditorState = {
      ...base(),
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        sizes: [0.4, 0.6],
        children: [
          makeLeaf('chat', ['chat:s1'], 'chat:s1', 'aux'),
          makeLeaf('ed', ['file:a.ts'], 'file:a.ts'), // NO role tag (pre-role layout)
        ],
      },
      items: {
        'chat:s1': { kind: 'chat', id: 'chat:s1', title: 'Chat' },
        'file:a.ts': file('a.ts'),
      },
    }
    const before = leafIds(s.root).length
    const r = resolveRoleGroupState(s, 'file', ids())
    expect(r.groupId).toBe('ed') // adopted, not spawned
    expect(leafIds(r.state.root).length).toBe(before)
    expect(findLeafByRole(r.state.root, 'editor')?.id).toBe('ed') // now tagged
    expect(r.state).not.toBe(s)
  })

  test('focus-aware: a same-role kind opens into the FOCUSED group, not just the first', () => {
    // Two editor-role groups (a split). Focus the SECOND; opening another editor
    // kind must land there, not in the first editor group.
    const s: EditorState = {
      ...base(),
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        sizes: [0.3, 0.35, 0.35],
        children: [
          makeLeaf('chat', ['chat:s1'], 'chat:s1', 'aux'),
          makeLeaf('ed', ['file:a.ts'], 'file:a.ts', 'editor'),
          makeLeaf('ed2', ['file:b.ts'], 'file:b.ts', 'editor'),
        ],
      },
      items: {
        'chat:s1': { kind: 'chat', id: 'chat:s1', title: 'Chat' },
        'file:a.ts': file('a.ts'),
        'file:b.ts': file('b.ts'),
      },
      activeGroup: 'ed2',
    }
    const r = resolveRoleGroupState(s, 'diff', ids())
    expect(r.groupId).toBe('ed2') // focused editor wins over the first ('ed')
    expect(r.state).toBe(s) // no allocation — pure reveal
  })

  test('spawns a new role group when none exists or matches', () => {
    const s: EditorState = {
      ...base(),
      root: makeLeaf('chat', ['chat:s1'], 'chat:s1', 'aux'),
      items: { 'chat:s1': { kind: 'chat', id: 'chat:s1', title: 'Chat' } },
    }
    // Only the aux base exists → opening an editor kind spawns the editor group.
    const r = resolveRoleGroupState(s, 'file', ids())
    expect(findLeafByRole(r.state.root, 'editor')?.id).toBe(r.groupId)
    expect(r.state).not.toBe(s)
  })
})

describe('closeScopeState', () => {
  const scoped = (path: string, scope: string): WorkItem => ({ ...file(path), scope })

  test('frees every tab of one session, keeps global + other sessions', () => {
    // One group holds: session A file, session B file, a GLOBAL settings tab.
    let s = openItemState(base(), scoped('a.ts', 'A'))
    s = openItemState(s, scoped('b.ts', 'B'))
    s = openItemState(s, { kind: 'settings', id: 'settings', title: 'Settings', scope: '@global' })
    s = closeScopeState(s, 'A')
    const g = findLeaf(s.root, 'g1')!
    expect(g.tabs).toEqual(['file:b.ts', 'settings'])
    expect(s.items['file:a.ts']).toBeUndefined()
    expect(s.items['file:b.ts']).toBeDefined()
  })

  test('collapses a group wholly owned by the closed scope, re-homing focus', () => {
    let s = openItemState(base(), scoped('a.ts', 'A')) // g1: A
    s = splitState(s, 'g1', 'right', 'g2') // g2 empty, focused
    s = openItemState({ ...s, activeGroup: 'g2' }, scoped('b.ts', 'B')) // g2: B
    s = closeScopeState(s, 'B') // g2 emptied → removed
    expect(leafIds(s.root)).toEqual(['g1'])
    expect(s.activeGroup).toBe('g1')
    expect(s.items['file:b.ts']).toBeUndefined()
  })

  test('is a no-op when the scope owns nothing', () => {
    const s = openItemState(base(), scoped('a.ts', 'A'))
    expect(closeScopeState(s, 'Z')).toBe(s)
  })

  test("forgets the closed scope's reopen-closed entries (no ⌘⇧T resurrection)", () => {
    // A non-ephemeral tab so it lands on the reopen stack when closed.
    const transcriptA: WorkItem = {
      kind: 'transcript',
      id: 'transcript:a',
      title: 'A',
      scope: 'A',
    }
    let s = openItemState(base(), transcriptA)
    s = openItemState(s, scoped('b.ts', 'B'))
    s = closeTabState(s, 'g1', 'transcript:a') // A's tab → onto the closed stack
    expect(s.closed.some((c) => c.item.id === 'transcript:a')).toBe(true)
    s = closeScopeState(s, 'A') // delete session A
    expect(s.closed.some((c) => c.item.id === 'transcript:a')).toBe(false)
  })
})

// A path-backed file WorkItem with an explicit id + payload.path (the tiered
// identity comparator + twin dedup read payload.path, not the id).
const pathFile = (id: string, path: string, extra?: Partial<WorkItem>): WorkItem => ({
  kind: 'file',
  id,
  title: path.split('/').pop() ?? path,
  payload: { path },
  ...extra,
})

describe('openItemState — tiered-identity twin dedup', () => {
  test('a different id resolving to the SAME normalized path reveals, never duplicates', () => {
    let s = openItemState(base(), pathFile('file:/repo/a.ts', '/repo/a.ts'))
    // A second open of the same file via an un-normalized textual path (different id).
    s = openItemState(s, pathFile('file:/repo/./a.ts', '/repo/./a.ts'))
    const g = findLeaf(s.root, 'g1')!
    expect(g.tabs).toEqual(['file:/repo/a.ts']) // folded onto the first tab
    expect(g.activeTab).toBe('file:/repo/a.ts')
  })

  test('the twin reveal keeps the existing tab id + on-disk path (no key remount)', () => {
    let s = openItemState(base(), pathFile('file:/repo/a.ts', '/repo/a.ts'))
    s = openItemState(
      s,
      pathFile('file:/repo/x/../a.ts', '/repo/x/../a.ts', {
        payload: { path: '/repo/x/../a.ts', line: 42 },
      }),
    )
    const kept = s.items['file:/repo/a.ts']
    expect(kept.payload?.path).toBe('/repo/a.ts') // stable path (no remount)
    expect(kept.payload?.line).toBe(42) // adopts the fresh reveal target
    expect(s.items['file:/repo/x/../a.ts']).toBeUndefined()
  })

  test('different files are never folded', () => {
    let s = openItemState(base(), pathFile('file:/a/foo.ts', '/a/foo.ts'))
    s = openItemState(s, pathFile('file:/b/foo.ts', '/b/foo.ts'))
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:/a/foo.ts', 'file:/b/foo.ts'])
  })

  test('path-less items (no payload.path) are never folded by name', () => {
    // Two distinct media tabs sharing a title must stay separate.
    const m1: WorkItem = {
      kind: 'file',
      id: 'file:media:1',
      title: 'report.pdf',
      payload: { mediaId: '1' },
    }
    const m2: WorkItem = {
      kind: 'file',
      id: 'file:media:2',
      title: 'report.pdf',
      payload: { mediaId: '2' },
    }
    let s = openItemState(base(), m1)
    s = openItemState(s, m2)
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:media:1', 'file:media:2'])
  })

  test('a twin in another scope is not folded (per-session isolation)', () => {
    let s = openItemState(base(), pathFile('file:A:/repo/a.ts', '/repo/a.ts', { scope: 'A' }))
    s = openItemState(s, pathFile('file:B:/repo/a.ts', '/repo/a.ts', { scope: 'B' }))
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:A:/repo/a.ts', 'file:B:/repo/a.ts'])
  })
})

describe('openItemState — replace (file-tree single-click preview)', () => {
  test('replaces the active preview slot in place (no pile-up)', () => {
    let s = openItemState(base(), pathFile('file:/a.ts', '/a.ts'), { replace: true })
    // First replace-open appends a preview.
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:/a.ts'])
    expect(s.items['file:/a.ts'].ephemeral).toBe(true) // marked preview
    s = openItemState(s, pathFile('file:/b.ts', '/b.ts'), { replace: true })
    // Second replace-open takes over the preview slot (a.ts gone).
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:/b.ts'])
  })

  test('never clobbers a PINNED active tab — appends a preview beside it', () => {
    let s = openItemState(base(), pathFile('file:/a.ts', '/a.ts')) // normal open → pinned
    expect(s.items['file:/a.ts'].ephemeral).toBe(false)
    s = openItemState(s, pathFile('file:/b.ts', '/b.ts'), { replace: true })
    const g = findLeaf(s.root, 'g1')!
    expect(g.tabs).toEqual(['file:/a.ts', 'file:/b.ts']) // pinned a.ts survives
    expect(s.items['file:/b.ts'].ephemeral).toBe(true)
  })

  test('never clobbers a DIRTY active preview — appends instead', () => {
    let s = openItemState(base(), pathFile('file:/a.ts', '/a.ts'), { replace: true })
    s = setItemDirtyState(s, 'file:/a.ts', true) // unsaved edits
    s = openItemState(s, pathFile('file:/b.ts', '/b.ts'), { replace: true })
    const g = findLeaf(s.root, 'g1')!
    expect(g.tabs).toEqual(['file:/a.ts', 'file:/b.ts']) // dirty a.ts survives
  })

  test('preserves the preview slot position when replacing', () => {
    let s = openItemState(base(), pathFile('file:/pinned.ts', '/pinned.ts')) // pinned, index 0
    s = openItemState(s, pathFile('file:/prev.ts', '/prev.ts'), { replace: true }) // preview, index 1
    s = setActiveTabState(s, 'g1', 'file:/prev.ts')
    s = openItemState(s, pathFile('file:/next.ts', '/next.ts'), { replace: true })
    // The preview is replaced in place at index 1, pinned stays at index 0.
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:/pinned.ts', 'file:/next.ts'])
  })
})

describe('openItemState — pin via explicit ephemeral:false (double-click)', () => {
  test('pins an already-open preview (protects it from later replace)', () => {
    let s = openItemState(base(), pathFile('file:/a.ts', '/a.ts'), { replace: true }) // preview
    expect(s.items['file:/a.ts'].ephemeral).toBe(true)
    s = openItemState(s, pathFile('file:/a.ts', '/a.ts'), { ephemeral: false }) // double-click reveal → pin
    expect(s.items['file:/a.ts'].ephemeral).toBe(false)
    // A subsequent single-click preview no longer clobbers it.
    s = openItemState(s, pathFile('file:/b.ts', '/b.ts'), { replace: true })
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:/a.ts', 'file:/b.ts'])
  })

  test('a fresh pin open (file not yet open) opens a pinned tab', () => {
    const s = openItemState(base(), pathFile('file:/a.ts', '/a.ts'), { ephemeral: false })
    expect(s.items['file:/a.ts'].ephemeral).toBe(false)
  })
})

describe('activate-on-close: "history" (the default)', () => {
  test('closing the active tab returns to the PREVIOUSLY-focused tab, not the neighbour', () => {
    // Tabs [a,b,c]. Focus order via clicks: a → b → c is active.
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('c.ts'))
    s = setActiveTabState(s, 'g1', 'file:a.ts') // history: [a, c, b]
    s = setActiveTabState(s, 'g1', 'file:b.ts') // history: [b, a, c]
    // b is active and sits in the MIDDLE. The positional neighbour would be c (right).
    // The history pick must return to a (the tab focused just before b).
    s = closeTabState(s, 'g1', 'file:b.ts')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts')
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts', 'file:c.ts'])
  })

  test('history skips tabs that were already closed', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('c.ts'))
    s = setActiveTabState(s, 'g1', 'file:a.ts') // history front: a
    s = setActiveTabState(s, 'g1', 'file:c.ts') // history: [c, a, b]
    s = closeTabState(s, 'g1', 'file:a.ts') // a not active → just drops from history
    // Now close the active c. History is [c(gone), a(gone), b] → the only survivor is b.
    s = closeTabState(s, 'g1', 'file:c.ts')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:b.ts')
  })

  test('never activates a tab hidden in the current scope (history respects scope)', () => {
    const chat = (scope: string): WorkItem => ({
      kind: 'chat',
      id: `chat:${scope}`,
      title: scope,
      scope,
      payload: { sessionId: scope },
    })
    const scopedFile = (scope: string): WorkItem => ({
      kind: 'file',
      id: `file:${scope}:a.ts`,
      title: 'a.ts',
      scope,
    })
    let s = openItemState(base(), scopedFile('A')) // visible file (scope A)
    s = openItemState(s, chat('B')) // hidden under scope A
    s = openItemState(s, chat('A')) // active chat (scope A)
    s = setActiveTabState(s, 'g1', 'chat:B') // history front would be chat:B (hidden in A)
    s = setActiveTabState(s, 'g1', 'chat:A') // active chat:A; history: [chat:A, chat:B, file:A:a.ts]
    // Closing chat:A while scope A is active: chat:B is most-recent in history but HIDDEN,
    // so it must be skipped in favour of the visible scope-A file.
    s = closeTabState(s, 'g1', 'chat:A', 'A')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:A:a.ts')
  })

  test('empty/exhausted history falls back to the positional neighbour', () => {
    // No explicit clicks that survive: open a, b, c (c active); close c.
    // History = [c, b, a] (opens record activation); after dropping c → [b, a],
    // both survive, so the pick is b — which is ALSO the positional neighbour here.
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('c.ts'))
    s = closeTabState(s, 'g1', 'file:c.ts')
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:b.ts')
  })

  test('closing a NON-active tab leaves the active tab untouched but drops it from history', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = setActiveTabState(s, 'g1', 'file:b.ts') // b active, history [b, a]
    s = closeTabState(s, 'g1', 'file:a.ts') // close the non-active a
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:b.ts')
    expect(findLeaf(s.root, 'g1')!.tabHistory).toEqual(['file:b.ts']) // a removed
  })

  test('setActiveTabState de-dups and caps history at MAX_TAB_HISTORY', () => {
    let s = base()
    for (let i = 0; i < MAX_TAB_HISTORY + 5; i++) s = openItemState(s, file(`f${i}.ts`))
    // Re-focus an existing tab repeatedly — must not create duplicates.
    s = setActiveTabState(s, 'g1', 'file:f20.ts')
    s = setActiveTabState(s, 'g1', 'file:f20.ts')
    const hist = findLeaf(s.root, 'g1')!.tabHistory ?? []
    expect(hist.length).toBeLessThanOrEqual(MAX_TAB_HISTORY)
    expect(hist[0]).toBe('file:f20.ts')
    expect(hist.filter((t) => t === 'file:f20.ts').length).toBe(1) // deduped
  })

  test('batch close (Close Others) re-points to a history survivor when the active tab is swept', () => {
    let s = openItemState(base(), file('a.ts'))
    s = openItemState(s, file('b.ts'))
    s = openItemState(s, file('c.ts'))
    s = setActiveTabState(s, 'g1', 'file:a.ts') // history front a
    s = setActiveTabState(s, 'g1', 'file:c.ts') // c active, history [c, a, b]
    // Close a + c; b survives. c was active → history pick over survivors {b} = b.
    s = closeTabsState(s, 'g1', ['file:a.ts', 'file:c.ts'])
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:b.ts'])
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:b.ts')
  })
})
