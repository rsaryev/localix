import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { miniAppUiHostFor, removeMiniAppUiContributions } from '@/shared/contrib/host'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
import { reconcileUnavailableContributedItems, useGridStore } from './store'

const KIND = 'reconcile-mini-app:tab'
const MINI_APP = 'reconcile-mini-app'

miniAppUiHostFor(MINI_APP).workItems.register({
  kind: KIND,
  Component: () => null,
  Icon: () => null,
  restorable: true,
  scope: 'global',
})

describe('reconcileUnavailableContributedItems', () => {
  beforeEach(() => {
    setEnabledMiniAppNames(new Set([MINI_APP]))
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
        { kind: KIND, id: 'mini-app:tab', title: 'Mini app tab', scope: '@global' },
        { group: 'group-root' },
      )
  })

  afterEach(() => {
    setEnabledMiniAppNames(null)
    useGridStore.getState().resetLayout()
  })

  test('does not erase a tab while mini app activation is still pending', () => {
    setEnabledMiniAppNames(null)
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['mini-app:tab']).toBeDefined()
  })

  test('keeps an unknown lazy kind pending, then removes it when no mini app registers it', () => {
    useGridStore
      .getState()
      .openItem(
        { kind: 'unregistered-lazy-kind', id: 'lazy:tab', title: 'Lazy mini app tab', scope: 's1' },
        { group: 'group-root' },
      )

    // A mini app kind in a session takes its chat in its id (`tabIdInScope`).
    setEnabledMiniAppNames(null)
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['lazy:tab@s1']).toBeDefined()

    setEnabledMiniAppNames(new Set())
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['lazy:tab@s1']).toBeUndefined()
  })

  test('closes confirmed-disabled mini app tabs without touching other tabs', () => {
    setEnabledMiniAppNames(new Set())
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['mini-app:tab']).toBeUndefined()
    expect(useGridStore.getState().items['file:keep.sql']).toBeDefined()
  })

  test('does not leave a disabled mini app tab in the reopen history', () => {
    setEnabledMiniAppNames(new Set())
    reconcileUnavailableContributedItems()

    expect(useGridStore.getState().closed.some(({ item }) => item.id === 'mini-app:tab')).toBe(
      false,
    )
    useGridStore.getState().reopenClosedTab()
    expect(useGridStore.getState().items['mini-app:tab']).toBeUndefined()
  })

  test('does not close a core-kind tab because a disabled mini app reused its kind', () => {
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

    setEnabledMiniAppNames(new Set())
    reconcileUnavailableContributedItems()

    expect(useGridStore.getState().items['chat:s1']).toBeDefined()
  })

  test('a removed mini app closes its tab even while another mini app has not loaded', () => {
    // Removing it drops it from the enabled set; another app's UI failing to load (a transient
    // 503, a broken build) must not keep the removed app's tab on screen.
    setEnabledMiniAppNames(new Set(), new Set(), new Set(['another-mini-app']))
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['mini-app:tab']).toBeUndefined()
    expect(useGridStore.getState().items['file:keep.sql']).toBeDefined()
  })

  test("a removed mini app's bridged view tab closes too", () => {
    useGridStore.getState().openItem(
      {
        kind: 'mini-app-view',
        id: 'mini-app-view:gone:board',
        title: 'Board',
        scope: 's1',
        payload: { miniAppName: 'gone-mini-app', viewId: 'board', projectId: '' },
      },
      { group: 'group-root' },
    )
    setEnabledMiniAppNames(new Set([MINI_APP]))
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['mini-app-view:gone:board']).toBeUndefined()
    expect(useGridStore.getState().items['mini-app:tab']).toBeDefined()
  })

  // A mini app's screen moved from the app to each chat (`scope: 'chat'`) and was installed again:
  // its open tab, opened while the screen was app-wide, kept belonging to no chat, so the screen
  // never had one to name and the rail button only focused that tab again.
  test('a tab of no chat closes once its screen, installed again, belongs to each chat', () => {
    const owner = 'reconcile-rescoped'
    const kind = `${owner}:screen`
    const screen = (scope: 'global' | 'session') => ({
      kind,
      Component: () => null,
      Icon: () => null,
      restorable: true,
      scope,
    })
    setEnabledMiniAppNames(new Set([MINI_APP, owner]))
    miniAppUiHostFor(owner).workItems.register(screen('global'))
    useGridStore
      .getState()
      .openItem(
        { kind, id: 'screen:tab', title: 'Screen', scope: '@global' },
        { group: 'group-root' },
      )
    expect(useGridStore.getState().items['screen:tab']).toBeDefined()

    removeMiniAppUiContributions(owner)
    miniAppUiHostFor(owner).workItems.register(screen('session'))
    reconcileUnavailableContributedItems()
    expect(useGridStore.getState().items['screen:tab']).toBeUndefined()
    expect(useGridStore.getState().closed.some(({ item }) => item.id === 'screen:tab')).toBe(false)
    expect(useGridStore.getState().items['mini-app:tab']).toBeDefined()
    removeMiniAppUiContributions(owner)
  })
})
