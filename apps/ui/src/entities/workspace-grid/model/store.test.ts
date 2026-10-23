import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { GLOBAL_SCOPE } from './scope'
import { useGridStore, nextGroupId, seedGroupSeq, setPreviewTabs } from './store'
import { findLeaf, leafIds } from './tree'
import type { WorkItem } from '@/shared/lib/workItem'

const get = () => useGridStore.getState()
// Every session tab names its chat on open; these all belong to S1 unless a test says otherwise.
const file = (p: string, scope = 'S1'): WorkItem => ({
  kind: 'file',
  id: `file:${p}`,
  title: p,
  scope,
})

beforeEach(() => {
  get().resetLayout()
})

describe('preview-tab preference', () => {
  // The store is the single chokepoint:
  // callers keep passing their `replace`/`ephemeral` hint and the store decides
  // whether it is honoured, so a new call site cannot bypass the preference.
  test('on (default), a replace open takes the preview slot', () => {
    setPreviewTabs(true)
    get().openItem(file('a.ts'), { replace: true })
    get().openItem(file('b.ts'), { replace: true })
    expect(findLeaf(get().root, 'group-root')!.tabs).toEqual(['file:b.ts'])
  })

  test('off, every file keeps its own tab and nothing is replaced', () => {
    setPreviewTabs(false)
    try {
      get().openItem(file('a.ts'), { replace: true })
      get().openItem(file('b.ts'), { ephemeral: true })
      expect(findLeaf(get().root, 'group-root')!.tabs).toEqual(['file:a.ts', 'file:b.ts'])
      expect(get().items['file:a.ts'].ephemeral).toBe(false) // explicitly pinned, not a preview
    } finally {
      setPreviewTabs(true)
    }
  })
})

describe('grid store actions', () => {
  test('openItem lands in the root group', () => {
    get().openItem(file('a.ts'))
    expect(findLeaf(get().root, 'group-root')!.tabs).toEqual(['file:a.ts'])
  })

  test('splitGroup returns a fresh id and creates a sibling', () => {
    get().openItem(file('a.ts'))
    const newId = get().splitGroup('group-root', 'right', 'file:a.ts')
    expect(typeof newId).toBe('string')
    expect(leafIds(get().root)).toEqual(['group-root', newId])
    expect(findLeaf(get().root, newId)!.tabs).toEqual(['file:a.ts'])
    expect(get().activeGroup).toBe(newId)
  })

  test('moveTab + closeTab collapse the grid back', () => {
    get().openItem(file('a.ts'))
    get().openItem(file('b.ts'))
    const g2 = get().splitGroup('group-root', 'right', 'file:b.ts')
    get().moveTab('file:a.ts', g2) // both now in g2, root empty → collapsed
    expect(leafIds(get().root)).toEqual([g2])
    get().closeTab(g2, 'file:a.ts')
    get().closeTab(g2, 'file:b.ts')
    expect(findLeaf(get().root, g2)!.tabs).toEqual([]) // last group emptied, kept
  })

  test('resizeBranch updates the branch sizes', () => {
    get().openItem(file('a.ts'))
    get().splitGroup('group-root', 'right')
    const root = get().root
    if (root.type !== 'branch') throw new Error('expected a branch after split')
    get().resizeBranch(root.id, [3, 1])
    const after = get().root
    // Assert the shape, THEN the sizes: `if (after.type === 'branch') expect(…)` was the
    // test's only assertion, so a resizeBranch that collapsed the root to a leaf ran zero
    // expectations and passed.
    expect(after.type).toBe('branch')
    if (after.type !== 'branch') throw new Error('expected a branch')
    expect(after.sizes).toEqual([0.75, 0.25])
  })

  test('split ids never collide with a restored tree (post-reload counter reset)', () => {
    // Simulate a reload: a persisted layout already holds group-1/group-2 while the
    // module counter has reset to 0. seedGroupSeq must skip past them, and the
    // unique-guard must reject any id that is still live.
    const live = ['group-root', 'group-1', 'group-2']
    seedGroupSeq(live)
    const a = nextGroupId(live)
    expect(live).not.toContain(a) // never re-mints a restored id
    // Even if the counter were behind, the guard advances past a live id.
    const b = nextGroupId(['group-root', a, 'group-9999'])
    expect([a, 'group-9999']).not.toContain(b)
  })

  test('splitting a restored grid produces unique leaf ids', () => {
    // Two splits in a row must yield two distinct sibling ids (no duplicates).
    get().openItem(file('a.ts'))
    const g1 = get().splitGroup('group-root', 'right')
    const g2 = get().splitGroup(g1, 'down')
    const ids = leafIds(get().root)
    expect(new Set(ids).size).toBe(ids.length)
    expect(g1).not.toBe(g2)
  })

  test('reopenClosedTab restores the last closed tab in its group', () => {
    get().openItem(file('a.ts'))
    get().openItem(file('b.ts'))
    get().closeTab('group-root', 'file:b.ts')
    expect(findLeaf(get().root, 'group-root')!.tabs).toEqual(['file:a.ts'])
    get().reopenClosedTab()
    expect(findLeaf(get().root, 'group-root')!.tabs).toContain('file:b.ts')
    // Stack is empty now → a second reopen is a no-op.
    const before = leafIds(get().root).length
    get().reopenClosedTab()
    expect(leafIds(get().root).length).toBe(before)
  })

  test('resolveRoleGroup: deterministic + adopts existing content groups', () => {
    // Seed a chat tab in the root, then a file via a manual split (untagged group).
    get().openItem({ kind: 'chat', id: 'chat:s1', title: 'Chat', scope: 's1' })
    const ed = get().splitGroup('group-root', 'right', undefined)
    get().openItem(file('a.ts', 's1'), { group: ed })
    // resolveRoleGroup('file') must ADOPT the existing file group, not spawn a new one.
    const before = leafIds(get().root).length
    const target = get().resolveRoleGroup('file')
    expect(target).toBe(ed)
    expect(leafIds(get().root).length).toBe(before) // no new group spawned
    // A second call is stable (now role-tagged).
    expect(get().resolveRoleGroup('file')).toBe(ed)
    // terminal is an editor kind now → resolves to the SAME editor group, stably.
    const t1 = get().resolveRoleGroup('terminal')
    const t2 = get().resolveRoleGroup('terminal')
    expect(t1).toBe(t2)
    expect(t1).toBe(ed)
  })

  test('maximizeGroup toggles', () => {
    get().openItem(file('a.ts'))
    get().maximizeGroup('group-root')
    expect(get().maximizedGroup).toBe('group-root')
    get().maximizeGroup('group-root')
    expect(get().maximizedGroup).toBeNull()
  })
})

describe('per-session scope', () => {
  beforeEach(() => {
    get().resetLayout()
    get().setActiveScope(GLOBAL_SCOPE)
  })

  test('a tab lives in the session its opener names, whatever chat is on screen', () => {
    // The scope used to be filled from the focused session when the opener named none, so a
    // file opened on behalf of one chat landed in whichever chat was on screen.
    get().setActiveScope('S2')
    get().openItem(file('a.ts', 'S1'))
    expect(get().items['file:a.ts'].scope).toBe('S1')
  })

  test('a session tab that names no session is refused, never stamped with the active chat', () => {
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    try {
      get().setActiveScope('S1')
      get().openItem({ kind: 'file', id: 'file:orphan', title: 'orphan' })
      get().openItem({ kind: 'preview', id: 'preview', title: 'Browser' })
      expect(get().items['file:orphan']).toBeUndefined()
      expect(Object.keys(get().items)).toEqual([])
      const refused = errors.mock.calls
        .map(([message]) => message)
        .filter(
          (message) =>
            typeof message === 'string' &&
            (message.startsWith('[grid] refused to open "file:orphan":') ||
              message.startsWith('[grid] refused to open "preview":')),
        )
      expect(refused).toEqual([
        '[grid] refused to open "file:orphan": a file tab names no session',
        '[grid] refused to open "preview": a preview tab names no session',
      ])
    } finally {
      errors.mockRestore()
    }
  })

  test('an app-level kind lives in the global scope, whatever the opener names', () => {
    get().openItem({ kind: 'settings', id: 'settings', title: 'Settings', scope: 'S1' })
    expect(get().items['settings'].scope).toBe(GLOBAL_SCOPE)
  })

  test('a singleton is one tab per chat', () => {
    // The Browser, Problems, Activity and Search tabs were one global tab that followed the
    // chat on screen; each chat now owns its own.
    get().openItem({ kind: 'preview', id: 'preview', title: 'Browser', scope: 'S1' })
    get().openItem({ kind: 'preview', id: 'preview', title: 'Browser', scope: 'S2' })
    expect(get().items['preview@S1']?.scope).toBe('S1')
    expect(get().items['preview@S2']?.scope).toBe('S2')
    expect(get().items['preview']).toBeUndefined()
  })

  test('identity-dedup records the tab id that was actually revealed', () => {
    get().setActiveScope('S1')
    get().openItem({
      kind: 'file',
      id: 'file:canonical',
      title: 'a.ts',
      scope: 'S1',
      payload: { path: '/repo/src/a.ts' },
    })
    get().openItem({
      kind: 'file',
      id: 'file:alias',
      title: 'a.ts',
      scope: 'S1',
      payload: { path: '/repo/src/./a.ts' },
    })

    expect(get().items['file:alias']).toBeUndefined()
    expect(get().scopeActiveTab.S1?.['group-root']).toEqual(['file:canonical'])
  })

  test('GLOBAL tab history follows a tab moved to another group', () => {
    get().setActiveScope('S1')
    get().openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
    const target = get().splitGroup('group-root', 'right')
    get().moveTab('settings', target)

    expect(get().scopeActiveTab[GLOBAL_SCOPE]?.['group-root']).toBeUndefined()
    expect(get().scopeActiveTab[GLOBAL_SCOPE]?.[target]).toEqual(['settings'])
  })

  test('GLOBAL tab history follows a tab split into a new group', () => {
    get().setActiveScope('S1')
    get().openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
    const target = get().splitGroup('group-root', 'right', 'settings')

    expect(get().scopeActiveTab[GLOBAL_SCOPE]?.['group-root']).toBeUndefined()
    expect(get().scopeActiveTab[GLOBAL_SCOPE]?.[target]).toEqual(['settings'])
  })

  test('reopened tabs re-enter keep-alive history', () => {
    get().setActiveScope('S1')
    get().openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
    get().closeTab('group-root', 'settings')
    expect(get().scopeActiveTab[GLOBAL_SCOPE]).toEqual({})

    get().reopenClosedTab()
    expect(get().scopeActiveTab[GLOBAL_SCOPE]?.['group-root']).toEqual(['settings'])
  })

  test('resetLayout clears stale tab lifecycle history', () => {
    get().setActiveScope('S1')
    get().openItem(file('a.ts', 'S1'))
    expect(get().scopeActiveTab.S1?.['group-root']).toEqual(['file:a.ts'])

    get().resetLayout()
    expect(get().scopeActiveTab).toEqual({})
    expect(get().activeScope).toBe('S1')
  })

  test('closeScope frees only that session’s tabs', () => {
    get().openItem(file('a.ts', 'S1'))
    get().openItem(file('b.ts', 'S2'))
    get().closeScope('S1')
    expect(get().items['file:a.ts']).toBeUndefined()
    expect(get().items['file:b.ts']).toBeDefined()
  })
})

describe('a mini app tab that belongs to one session', () => {
  // A contributed kind (not a core one) with no `scope: 'global'`: one instance per chat.
  const board = (scope: string): WorkItem => ({
    kind: 'game:board',
    id: 'game:board',
    title: 'Board',
    scope,
  })
  afterEach(() => get().setActiveScope(GLOBAL_SCOPE))

  test('opened from another chat, it becomes that chat’s own tab — the first never moves', () => {
    get().openItem(board('S-A'))
    get().openItem(board('S-B'))
    expect(get().items['game:board@S-A']?.scope).toBe('S-A')
    expect(get().items['game:board@S-B']?.scope).toBe('S-B')
  })

  test('re-opened in its own chat, it is revealed, not duplicated', () => {
    get().openItem(board('S-A'))
    get().openItem(board('S-A'))
    get().openItem({ ...board('S-A'), id: 'game:board@S-A' })
    expect(Object.keys(get().items).filter((id) => id.startsWith('game:board'))).toEqual([
      'game:board@S-A',
    ])
  })

  test('deleting the chat closes its tab and leaves the other chat’s', () => {
    get().openItem(board('S-A'))
    get().openItem(board('S-B'))
    get().closeScope('S-A')
    expect(get().items['game:board@S-A']).toBeUndefined()
    expect(get().items['game:board@S-B']).toBeDefined()
  })

  test('non-singleton core kinds and app-level tabs keep the id they were opened with', () => {
    get().openItem(file('a.ts', 'S-A'))
    get().openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
    expect(get().items['file:a.ts']).toBeDefined()
    expect(get().items['settings']).toBeDefined()
  })
})
