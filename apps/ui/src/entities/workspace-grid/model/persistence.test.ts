import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadGrid, emptyEditorState, persistGrid, type PersistedGrid } from './persistence'
import { flushAllBeforeQuit } from '@/shared/lib/quitFlush'
import { leafIds, findLeaf } from './tree'
import { miniAppUiHostFor } from '@/shared/contrib/host'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  installTestLocalStorage({
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  })
  return map
}

const STORAGE_KEY = 'workspace_grid_v2'

describe('loadGrid', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = installStorage()
    setEnabledMiniAppNames(null)
  })
  afterEach(() => {
    setEnabledMiniAppNames(null)
    removeTestLocalStorage()
  })

  const seed = (blob: PersistedGrid) => store.set(STORAGE_KEY, JSON.stringify(blob))

  test('returns null when absent', () => {
    expect(loadGrid()).toBeNull()
  })

  test('a mini app store tab from before the Store comes back as the Store on its Mini apps shelf', () => {
    seed({
      root: {
        type: 'leaf',
        id: 'g1',
        tabs: ['chat:1', 'mini-app-store'],
        activeTab: 'mini-app-store',
      },
      items: [
        { kind: 'chat', id: 'chat:1', title: 'Chat', scope: 's1' },
        { kind: 'mini-app-store', id: 'mini-app-store', title: 'Mini apps', scope: '@global' },
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const grid = loadGrid()!
    expect(grid.items['mini-app-store']).toBeUndefined()
    expect(grid.items.store).toMatchObject({
      kind: 'store',
      id: 'store',
      title: 'Store',
      payload: { shelf: 'package:mini-app' },
    })
    expect(findLeaf(grid.root, 'g1')).toMatchObject({
      tabs: ['chat:1', 'store'],
      activeTab: 'store',
    })
  })

  test('a restart interrupted by reload restores the exited terminal without a pending spawn flag', () => {
    const payload = {
      terminalId: 'dead',
      sessionId: 's1',
      terminalRestarting: true,
      terminalExit: { exitCode: 1, command: 'bun build' },
    }
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['terminal:dead'], activeTab: 'terminal:dead' },
      items: [{ kind: 'terminal', id: 'terminal:dead', title: 'Build', scope: 's1', payload }],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const { terminalRestarting: _pending, ...restoredPayload } = payload
    expect(loadGrid()?.items['terminal:dead']?.payload).toEqual(restoredPayload)
  })

  test('retains a registered mini app tab while activation is still loading', () => {
    const kind = 'slow-mini-app:pending-persistence-fixture'
    miniAppUiHostFor('slow-mini-app').workItems.register({
      kind,
      Component: () => null,
      Icon: () => null,
      restorable: true,
      scope: 'global',
    })
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['slow:tab'], activeTab: 'slow:tab' },
      items: [
        {
          kind,
          id: 'slow:tab',
          title: 'Slow mini app tab',
          scope: '@global',
          payload: { stable: true },
        },
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })

    expect(loadGrid()?.items['slow:tab']?.payload).toEqual({ stable: true })
  })

  test('retains an unregistered lazy mini app tab while activation is still loading', () => {
    const kind = 'lazy-persistence-fixture'
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['lazy:tab'], activeTab: 'lazy:tab' },
      items: [
        {
          kind,
          id: 'lazy:tab',
          title: 'Lazy mini app tab',
          scope: '@global',
          payload: { stable: true },
        },
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })

    expect(loadGrid()?.items['lazy:tab']?.payload).toEqual({ stable: true })
  })

  test('drops a mini app tab only after its owner is authoritatively disabled', () => {
    const kind = 'disabled-mini-app:persistence-fixture'
    miniAppUiHostFor('disabled-mini-app').workItems.register({
      kind,
      Component: () => null,
      Icon: () => null,
      restorable: true,
      scope: 'global',
    })
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['disabled:tab'], activeTab: 'disabled:tab' },
      items: [{ kind, id: 'disabled:tab', title: 'Disabled mini app tab' }],
      activeGroup: 'g1',
      maximizedGroup: null,
    })

    setEnabledMiniAppNames(new Set())
    expect(loadGrid()?.items['disabled:tab']).toBeUndefined()
  })

  test('a disabled mini app registration cannot make a restorable core kind disappear', () => {
    expect(() =>
      miniAppUiHostFor('core-kind-shadow').workItems.register({
        kind: 'chat',
        Component: () => null,
        Icon: () => null,
        restorable: false,
      }),
    ).toThrow('must be namespaced by owner "core-kind-shadow:"')
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['chat:s1'], activeTab: 'chat:s1' },
      items: [{ kind: 'chat', id: 'chat:s1', title: 'Chat', scope: 's1' }],
      activeGroup: 'g1',
      maximizedGroup: null,
    })

    setEnabledMiniAppNames(new Set())
    expect(loadGrid()?.items['chat:s1']).toBeDefined()
  })

  test('restores a two-group horizontal grid', () => {
    seed({
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        children: [
          { type: 'leaf', id: 'g1', tabs: ['file:b.ts'], activeTab: 'file:b.ts' },
          { type: 'leaf', id: 'g2', tabs: ['file:a.ts'], activeTab: 'file:a.ts' },
        ],
        sizes: [0.5, 0.5],
      },
      items: [
        { kind: 'file', id: 'file:b.ts', title: 'b.ts', scope: 's1', payload: { path: 'b.ts' } },
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1', payload: { path: 'a.ts' } },
      ],
      activeGroup: 'g2',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(leafIds(s.root)).toEqual(['g1', 'g2'])
    expect(s.activeGroup).toBe('g2')
    expect(s.items['file:a.ts'].payload).toEqual({ path: 'a.ts' })
  })

  test('drops non-restorable items and prunes their tabs', () => {
    seed({
      root: {
        type: 'leaf',
        id: 'g1',
        tabs: ['file:a.ts', 'transcript-x', 'diff:a.ts'],
        activeTab: 'transcript-x',
      },
      items: [
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
        { kind: 'transcript', id: 'transcript-x', title: 'Transcript', scope: 's1' }, // not restorable
        { kind: 'diff', id: 'diff:a.ts', title: 'a.ts', scope: 's1' }, // not restorable
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts'])
    expect(findLeaf(s.root, 'g1')!.activeTab).toBe('file:a.ts') // re-picked
  })

  test('preserves leaf placement roles across a save/load round-trip', () => {
    // Roles drive deterministic placement; they must survive a reload, else groups
    // re-spawn and the layout drifts. Lock the invariant here.
    seed({
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        children: [
          { type: 'leaf', id: 'g1', tabs: ['chat:s1'], activeTab: 'chat:s1', role: 'aux' },
          { type: 'leaf', id: 'g2', tabs: ['file:a.ts'], activeTab: 'file:a.ts', role: 'editor' },
        ],
        sizes: [0.4, 0.6],
      },
      items: [
        { kind: 'chat', id: 'chat:s1', title: 'Chat', scope: 's1' },
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
      ],
      activeGroup: 'g2',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(findLeaf(s.root, 'g1')!.role).toBe('aux')
    expect(findLeaf(s.root, 'g2')!.role).toBe('editor')
  })

  test('a leaf persisted WITHOUT tabHistory loads fine (backward compatible)', () => {
    seed({
      root: { type: 'leaf', id: 'g1', tabs: ['file:a.ts', 'file:b.ts'], activeTab: 'file:b.ts' },
      items: [
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
        { kind: 'file', id: 'file:b.ts', title: 'b.ts', scope: 's1' },
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts', 'file:b.ts'])
    expect(findLeaf(s.root, 'g1')!.tabHistory).toBeUndefined() // stays clean, no crash
  })

  test('restores tabHistory but filters out ids whose tabs did not survive', () => {
    seed({
      root: {
        type: 'leaf',
        id: 'g1',
        tabs: ['file:a.ts', 'transcript-x'],
        activeTab: 'file:a.ts',
        tabHistory: ['transcript-x', 'file:a.ts', 'file:gone.ts'],
      },
      items: [
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
        { kind: 'transcript', id: 'transcript-x', title: 'Transcript', scope: 's1' }, // not restorable → tab pruned
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    // transcript-x (pruned) + file:gone.ts (never present) drop; only the surviving file remains.
    expect(findLeaf(s.root, 'g1')!.tabHistory).toEqual(['file:a.ts'])
  })

  test('collapses an emptied group and fixes a stale activeGroup', () => {
    seed({
      root: {
        type: 'branch',
        id: 'b',
        orientation: 'h',
        children: [
          { type: 'leaf', id: 'g1', tabs: ['file:a.ts'], activeTab: 'file:a.ts' },
          { type: 'leaf', id: 'g2', tabs: ['transcript-x'], activeTab: 'transcript-x' }, // becomes empty
        ],
        sizes: [0.5, 0.5],
      },
      items: [
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
        { kind: 'transcript', id: 'transcript-x', title: 'Transcript', scope: 's1' },
      ],
      activeGroup: 'g2',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(leafIds(s.root)).toEqual(['g1']) // g2 emptied → collapsed
    expect(s.activeGroup).toBe('g1') // stale g2 fixed
  })

  test('a stored tab is restored only into the session it names', () => {
    // A tab saved before every tab named its chat had no scope (or the global one for a former
    // singleton) and was shown in whichever chat opened first. It is dropped; app-level tabs and
    // properly scoped ones survive.
    seed({
      root: {
        type: 'leaf',
        id: 'g1',
        tabs: ['file:a.ts', 'file:legacy.ts', 'preview', 'settings', 'preview@s1'],
        activeTab: 'file:a.ts',
      },
      items: [
        { kind: 'file', id: 'file:a.ts', title: 'a.ts', scope: 's1' },
        { kind: 'file', id: 'file:legacy.ts', title: 'legacy.ts' },
        { kind: 'preview', id: 'preview', title: 'Browser', scope: '@global' },
        { kind: 'settings', id: 'settings', title: 'Settings', scope: '@global' },
        { kind: 'preview', id: 'preview@s1', title: 'Browser', scope: 's1' },
      ],
      activeGroup: 'g1',
      maximizedGroup: null,
    })
    const s = loadGrid()!
    expect(findLeaf(s.root, 'g1')!.tabs).toEqual(['file:a.ts', 'settings', 'preview@s1'])
    expect(s.items['preview@s1']?.scope).toBe('s1')
    expect(s.items['settings']?.scope).toBe('@global')
  })
})

describe('persistGrid before quit', () => {
  afterEach(() => {
    removeTestLocalStorage()
  })

  test('a quit inside the debounce window still writes the latest grid', async () => {
    const store = installStorage()
    persistGrid(emptyEditorState('quit-group'))
    // The 250 ms debounce has not fired: this is exactly where a quit used to lose it.
    expect(store.has(STORAGE_KEY)).toBe(false)
    expect(await flushAllBeforeQuit(100)).toEqual([])
    expect(JSON.parse(store.get(STORAGE_KEY)!).activeGroup).toBe('quit-group')
  })

  test('saving a pending restart retains its launch and exit data without persisting the promise flag', async () => {
    const store = installStorage()
    const payload = {
      terminalId: 'dead',
      sessionId: 's1',
      terminalRestarting: true,
      terminalExit: { exitCode: 1, command: 'bun build', cwd: '/fixture' },
    }
    persistGrid({
      ...emptyEditorState('g1'),
      root: { type: 'leaf', id: 'g1', tabs: ['terminal:dead'], activeTab: 'terminal:dead' },
      items: {
        'terminal:dead': {
          kind: 'terminal',
          id: 'terminal:dead',
          title: 'Build',
          scope: 's1',
          payload,
        },
      },
    })
    await flushAllBeforeQuit(100)
    const saved = JSON.parse(store.get(STORAGE_KEY)!) as PersistedGrid
    expect(saved.items[0]?.payload).toEqual({
      terminalId: 'dead',
      sessionId: 's1',
      terminalExit: { exitCode: 1, command: 'bun build', cwd: '/fixture' },
    })
    expect(payload.terminalRestarting).toBe(true)
  })
})

describe('emptyEditorState', () => {
  test('single empty group', () => {
    const s = emptyEditorState('root')
    expect(s.root).toEqual({ type: 'leaf', id: 'root', tabs: [], activeTab: null })
    expect(s.activeGroup).toBe('root')
  })
})
