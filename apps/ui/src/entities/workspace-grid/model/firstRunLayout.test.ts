// A first run (no stored layout) opens one empty group, which shows the workspace tips; a saved
// layout is restored as left.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PersistedGrid } from './persistence'
import { __resetGridForTests, hydrateGrid, useGridStore } from './store'
import { leaves } from './tree'

const STORAGE_KEY = 'workspace_grid_v2'

function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  return map
}

describe('first-run workspace layout', () => {
  let storage: Map<string, string>
  beforeEach(() => {
    __resetGridForTests()
    storage = installStorage()
  })
  afterEach(() => {
    __resetGridForTests()
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  test('no stored layout hydrates to a single empty group with nothing open', () => {
    hydrateGrid()
    const state = useGridStore.getState()
    const groups = leaves(state.root)
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual([])
    expect(state.items).toEqual({})
    expect(state.maximizedGroup).toBeNull()
  })

  test('a saved layout is still restored', () => {
    const tab = 'preview'
    const blob: PersistedGrid = {
      root: { type: 'leaf', id: 'group-root', tabs: [tab], activeTab: tab },
      items: [{ kind: 'preview', id: tab, title: 'Browser', scope: 'global' }],
      activeGroup: 'group-root',
      maximizedGroup: null,
    }
    storage.set(STORAGE_KEY, JSON.stringify(blob))
    hydrateGrid()
    const groups = leaves(useGridStore.getState().root)
    expect(groups.flatMap((g) => g.tabs)).toContain(tab)
  })
})
