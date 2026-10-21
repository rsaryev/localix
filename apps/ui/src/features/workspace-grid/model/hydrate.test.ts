// A tab contributed by a lazily loaded bundled plugin must survive cold restore even
// before the backend confirms which plugin modules may execute. Unknown kinds are
// retained during that pending phase and reconciled after the authoritative snapshot.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadGrid, type PersistedGrid } from './persistence'
import { __resetGridForTests, hydrateGrid, useGridStore } from './store'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { setEnabledPluginNames } from '@/shared/contrib/pluginActivation'
import type { WorkItemKind } from '@/shared/lib/workItem'

const KIND = 'db-console' as WorkItemKind
const TAB = 'db-console:conn1'
const STORAGE_KEY = 'workspace_grid_v2'

const BLOB: PersistedGrid = {
  root: { type: 'leaf', id: 'group-root', tabs: [TAB], activeTab: TAB },
  items: [
    { kind: KIND, id: TAB, title: 'conn1', scope: 'global', payload: { connectionId: 'conn1' } },
  ],
  activeGroup: 'group-root',
  maximizedGroup: null,
}

function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  return map
}

describe('grid hydration happens after subsystem discovery', () => {
  beforeEach(() => {
    // Establish the pre-hydration state rather than inherit it: `hydrateGrid` is
    // once-only module state, so whichever test ran first used to decide the rest.
    __resetGridForTests()
    setEnabledPluginNames(null)
    installStorage().set(STORAGE_KEY, JSON.stringify(BLOB))
  })
  afterEach(() => {
    __resetGridForTests()
    setEnabledPluginNames(null)
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  test('an unregistered contributed kind is retained while activation is pending', () => {
    expect(loadGrid()!.items[TAB]).toBeDefined()
  })

  test('once registered, hydrateGrid restores the tab with its payload', () => {
    workItemKindRegistry.register({
      kind: KIND,
      Component: () => null,
      Icon: () => null,
      restorable: true,
      scope: 'global',
    })
    // The store must still be empty — it no longer reads the layout on import.
    expect(Object.keys(useGridStore.getState().items)).toHaveLength(0)

    hydrateGrid()

    const item = useGridStore.getState().items[TAB]
    expect(item).toBeDefined()
    expect(item.payload).toEqual({ connectionId: 'conn1' })
    expect(useGridStore.getState().activeGroup).toBe('group-root')
  })

  test('hydration is once-only — a second call cannot replace live tabs', () => {
    hydrateGrid()
    const before = useGridStore.getState().items
    hydrateGrid()
    expect(useGridStore.getState().items).toBe(before)
  })
})
