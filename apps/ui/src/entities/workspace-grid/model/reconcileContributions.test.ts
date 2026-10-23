import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { miniAppUiHostFor } from '@/shared/contrib/host'
import { setEnabledPluginNames } from '@/shared/contrib/miniAppActivation'
import { reconcileUnavailableContributedItems, useGridStore } from './store'

const KIND = 'reconcile-plugin:tab'
const PLUGIN = 'reconcile-plugin'

miniAppUiHostFor(PLUGIN).workItems.register({
  kind: KIND,
  Component: () => null,
  Icon: () => null,
  restorable: true,
  scope: 'global',
})

describe('reconcileUnavailableContributedItems', () => {
  beforeEach(() => {
    setEnabledPluginNames(new Set([PLUGIN]))
    useGridStore.getState().resetLayout()
    useGridStore.getState().openItem(
      {
        kind: 'file',
        id: 'file:keep.sql',
        title: 'keep.sql',
        scope: 's1',
        payload: { path: 'keep.sql' },
      },
      { group: 'group-root' },
    )
    useGridStore
      .getState()
      .openItem(
        { kind: KIND, id: 'plugin:tab', title: 'Plugin tab', scope: '@global' },
        { group: 'group-root' },
      )
  })

  afterEach(() => {
    setEnabledPluginNames(null)
    useGridStore.getState().resetLayout()
  })

  test('does not erase a tab while plugin activation is still pending', () => {
    setEnabledPluginNames(null)
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['plugin:tab']).toBeDefined()
  })

  test('keeps an unknown lazy kind pending, then removes it when no plugin registers it', () => {
    useGridStore
      .getState()
      .openItem(
        { kind: 'unregistered-lazy-kind', id: 'lazy:tab', title: 'Lazy plugin tab', scope: 's1' },
        { group: 'group-root' },
      )

    // A plugin kind in a session takes its chat in its id (`tabIdInScope`).
    setEnabledPluginNames(null)
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['lazy:tab@s1']).toBeDefined()

    setEnabledPluginNames(new Set())
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['lazy:tab@s1']).toBeUndefined()
  })

  test('closes confirmed-disabled plugin tabs without touching other tabs', () => {
    setEnabledPluginNames(new Set())
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['plugin:tab']).toBeUndefined()
    expect(useGridStore.getState().items['file:keep.sql']).toBeDefined()
  })

  test('does not leave a disabled plugin tab in the reopen history', () => {
    setEnabledPluginNames(new Set())
    reconcileUnavailableContributedItems()

    expect(useGridStore.getState().closed.some(({ item }) => item.id === 'plugin:tab')).toBe(false)
    useGridStore.getState().reopenClosedTab()
    expect(useGridStore.getState().items['plugin:tab']).toBeUndefined()
  })

  test('does not close a core-kind tab because a disabled plugin reused its kind', () => {
    expect(() =>
      miniAppUiHostFor('core-kind-shadow-reconcile').workItems.register({
        kind: 'chat',
        Component: () => null,
        Icon: () => null,
        restorable: false,
      }),
    ).toThrow('must be namespaced by owner "core-kind-shadow-reconcile:"')
    useGridStore
      .getState()
      .openItem(
        { kind: 'chat', id: 'chat:s1', title: 'Chat', scope: 's1', payload: { sessionId: 's1' } },
        { group: 'group-root' },
      )

    setEnabledPluginNames(new Set())
    reconcileUnavailableContributedItems()

    expect(useGridStore.getState().items['chat:s1']).toBeDefined()
  })
})
