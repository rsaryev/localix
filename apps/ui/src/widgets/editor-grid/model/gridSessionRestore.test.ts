// Selecting a restored session must not re-activate its chat over the tab that was
// active when the shell was serialized. The assertion spans grid hydration and the
// chat-selection sync this widget owns, so it lives here: `features/workspace-grid`,
// where the rest of the hydration tests live, may not import a widget.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PersistedGrid } from '@/entities/workspace-grid/model/persistence'
import { __resetGridForTests } from '@/entities/workspace-grid/model/store'
import {
  activeWorkItemContribution,
  findLeaf,
  groupViewModel,
  hydrateGrid,
  reconcileUnavailableContributedItems,
  useGridStore,
} from '@/entities/workspace-grid/model'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { miniAppUiHostFor } from '@/shared/contrib/host'
import { setEnabledPluginNames } from '@/shared/contrib/miniAppActivation'
import { syncGridChatSelection } from './useGridChatSync'

const STORAGE_KEY = 'workspace_grid_v2'

// A sibling *.dom test in this directory registers a DOM, which leaves a READ-ONLY
// `localStorage` accessor on globalThis for whatever runs next in the same process.
// Plain assignment throws against it, so define the property instead — that overrides
// an accessor and a plain value alike, and stays deletable for the teardown below.
function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  })
  return map
}

describe('a restored session keeps the tab it was serialized with', () => {
  beforeEach(() => {
    __resetGridForTests()
    setEnabledPluginNames(null)
    installStorage()
  })
  afterEach(() => {
    __resetGridForTests()
    setEnabledPluginNames(null)
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  test('a session contributed-workspace tab survives cold hydration and remains selected after activation', () => {
    const sessionId = 'session-with-board'
    const boardTab = 'sample-space:workspace'
    const chatTab = `chat:${sessionId}`
    const serialized: PersistedGrid = {
      root: {
        type: 'leaf',
        id: 'group-root',
        tabs: [chatTab, boardTab],
        activeTab: boardTab,
      },
      items: [
        {
          kind: 'chat',
          id: chatTab,
          title: 'Board session',
          scope: sessionId,
          payload: { sessionId },
        },
        {
          kind: 'sample-space:workspace',
          id: boardTab,
          title: 'Sample workspace',
          scope: sessionId,
          payload: { boardId: 'board-1' },
        },
      ],
      activeGroup: 'group-root',
      maximizedGroup: null,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized))

    // Reload happens before the enabled-plugin snapshot and its lazy UI chunk.
    hydrateGrid()
    expect(useGridStore.getState().items[boardTab]?.payload).toEqual({ boardId: 'board-1' })

    if (!workItemKindRegistry.getRegistered('sample-space:workspace')) {
      miniAppUiHostFor('sample-space').workItems.register({
        kind: 'sample-space:workspace',
        Component: () => null,
        Icon: () => null,
        restorable: true,
        scope: 'session',
      })
    }
    setEnabledPluginNames(new Set(['sample-space']))
    reconcileUnavailableContributedItems()

    // Selecting the restored session must not re-activate its chat over the
    // board that was active when the shell was serialized.
    syncGridChatSelection(useGridStore.getState(), sessionId, 'Board session', null)
    const state = useGridStore.getState()
    const leaf = findLeaf(state.root, 'group-root')!
    const view = groupViewModel(
      leaf,
      state.items,
      state.activeScope,
      state.warmScopes,
      state.scopeActiveTab,
    )

    expect(activeWorkItemContribution('sample-space:workspace')).toBeDefined()
    expect(view.visibleTabs).toContain(boardTab)
    expect(view.visibleActive).toBe(boardTab)
    expect(view.mountIds[0]).toBe(boardTab)
  })
})
