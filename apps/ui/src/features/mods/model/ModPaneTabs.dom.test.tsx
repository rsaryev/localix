import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModPaneRef, ModsOverview } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const pane = (id: string, extra: Partial<ModPaneRef> = {}): ModPaneRef => ({
  instance: 'gauge@p1',
  plugin: 'gauge',
  id,
  title: `Pane ${id}`,
  cwd: '/work/p1',
  closeOnEscape: false,
  focusRequest: 0,
  ...extra,
})
const overview = (panes: ModPaneRef[]): ModsOverview => ({ mods: [], panes, failures: {} })

test('pane tabs follow the panes: opened in the background, focused when asked, closed with the pane', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig, useSWRConfig } = await import('swr')
  const { useGridStore, groupOfTab } = await import('@/entities/workspace-grid/model')
  const { workItemKindRegistry } = await import('@/shared/contrib/uiContrib')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const { modsApi } = await import('@/shared/api/modsApi')
  const { ModPaneTabs } = await import('./ModPaneTabs')
  const { modPaneTabId } = await import('./paneTabs')
  workItemKindRegistry.register({
    kind: 'mod-pane',
    Component: () => null,
    Icon: () => null,
    scope: 'global',
  })
  // The workspace's open and close requests, as the editor grid applies them to its store.
  const unregister = registerInspectorHandler((request) => {
    const grid = useGridStore.getState()
    if (request.kind === 'work-item')
      grid.openItem(
        { kind: request.workKind, id: request.id, title: request.title, payload: request.payload },
        { group: grid.activeGroup, activate: request.activate !== false },
      )
    if (request.kind === 'close-work-items') {
      const leaf = groupOfTab(grid.root, request.prefix)
      if (leaf) grid.closeTab(leaf.id, request.prefix)
    }
  })
  const closed: string[] = []
  const close = spyOn(modsApi, 'close').mockImplementation(async (_instance, id) => {
    closed.push(id)
  })
  let current = overview([pane('log')])
  const read = spyOn(modsApi, 'overview').mockImplementation(async () => current)
  let mutate: (key: string, data: unknown, revalidate: boolean) => Promise<unknown> = async () => {}
  function Probe() {
    mutate = useSWRConfig().mutate as typeof mutate
    return <ModPaneTabs />
  }
  useGridStore.getState().openItem({ kind: 'settings', id: 'settings', title: 'Settings' })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const cache = new Map()
  const settle = () => React.act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  const set = async (next: ModsOverview) => {
    current = next
    await React.act(async () => {
      await mutate('mods-overview', next, false)
    })
    await settle()
  }
  const activeOf = (id: string) => groupOfTab(useGridStore.getState().root, id)?.activeTab
  try {
    await React.act(async () =>
      root.render(
        <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
          <Probe />
        </SWRConfig>,
      ),
    )
    await settle()
    // A pane already open when the window reads them gets a tab, behind what the person is on.
    const log = modPaneTabId(pane('log'))
    expect(useGridStore.getState().items[log]?.title).toBe('Pane log')
    expect(activeOf(log)).not.toBe(log)

    // A new pane the mod asked forward opens focused.
    const diff = pane('diff', { focusRequest: 1 })
    await set(overview([pane('log'), diff]))
    expect(activeOf(modPaneTabId(diff))).toBe(modPaneTabId(diff))

    // The person closes a tab: the pane is asked to close; the mod refused, so it comes back.
    const leaf = groupOfTab(useGridStore.getState().root, log)!
    await React.act(async () => useGridStore.getState().closeTab(leaf.id, log))
    await settle()
    expect(closed).toEqual(['log'])
    expect(useGridStore.getState().items[log]).toBeDefined()

    // The mod closed its pane: its tab goes.
    await set(overview([pane('log')]))
    expect(useGridStore.getState().items[modPaneTabId(diff)]).toBeUndefined()
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    unregister()
    close.mockRestore()
    read.mockRestore()
  }
})
