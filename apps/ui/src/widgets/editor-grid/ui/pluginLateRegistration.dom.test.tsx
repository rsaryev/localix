import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const withUi = (name: string) =>
  ({ name, enabled: true, ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' } }) as never

/**
 * Plugins register lazily, after the first paint. Surfaces that read a registry during render
 * used to re-read it only when their parent re-rendered: a restored tab stayed on "Restoring…"
 * until the SLOWEST plugin loaded, and a session surface (the Git poller) never mounted until an
 * unrelated render. Each now subscribes to its own slice, and only that slice re-renders.
 */
describe('surfaces follow a plugin that registers after the first paint', () => {
  test('a restored tab renders once ITS plugin registers; another tab is not re-rendered', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { WorkItemBody } = await import('./registry')
    const { pluginUiHostFor } = await import('@/shared/contrib/host')
    const { workItemKindRegistry } = await import('@/shared/contrib/uiContrib')
    const { refetchPluginContrib, __resetPluginContrib } =
      await import('@/shared/contrib/enabledPlugins')
    const { __setRegistryFlushScheduler, flushRegistryChanges } =
      await import('@/shared/contrib/registryChanges')
    __setRegistryFlushScheduler(() => () => {})

    let bystanderRenders = 0
    workItemKindRegistry.register({
      kind: 'bystander-late:view',
      pluginName: 'bystander-late',
      Component: () => {
        bystanderRenders += 1
        return <p>bystander</p>
      },
    } as never)
    let settle!: (name: string, ok: boolean) => void
    const loaded = { loadSnapshot: async () => snapshotOf(['probe-late', 'slow-late']) }
    void refetchPluginContrib(loaded as never, (_plugins, settled) => {
      settle = settled!
      return new Promise<void>(() => {})
    })
    await act(async () => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const probe = { id: 'probe-late:view', title: 'Probe', kind: 'probe-late:view' }
    const other = { id: 'bystander-late:view', title: 'Other', kind: 'bystander-late:view' }
    try {
      await act(async () =>
        root.render(
          <>
            <WorkItemBody item={probe} visible focused resolvedTheme="dark" />
            <WorkItemBody item={other} visible focused={false} resolvedTheme="dark" />
          </>,
        ),
      )
      expect(host.textContent).toContain('Restoring workspace')
      const rendersBefore = bystanderRenders

      // The probe's plugin lands while `slow-late` is still loading: no capability publish.
      pluginUiHostFor('probe-late').workItems.register({
        kind: 'probe-late:view',
        Component: () => <p>probe registered</p>,
      } as never)
      settle('probe-late', true)
      await act(async () => flushRegistryChanges())

      expect(host.textContent).toContain('probe registered')
      expect(bystanderRenders).toBe(rendersBefore)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      workItemKindRegistry.removeOwner('probe-late')
      workItemKindRegistry.removeOwner('bystander-late')
      __resetPluginContrib()
      __setRegistryFlushScheduler(null)
    }

    function snapshotOf(names: string[]) {
      return {
        revision: 1,
        scope: { projectId: '', agentId: null },
        plugins: [...names.map(withUi), { name: 'bystander-late', enabled: true }],
        views: [],
      }
    }
  })

  test('a session surface mounts a fill registered after it rendered', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { SessionSurface } = await import('@/shared/contrib/sessionSurfaces')
    const { pluginUiHostFor, removePluginUiContributions } = await import('@/shared/contrib/host')
    const { __setRegistryFlushScheduler, flushRegistryChanges } =
      await import('@/shared/contrib/registryChanges')
    __setRegistryFlushScheduler(() => () => {})

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(<SessionSurface surface="late.surface.probe" sessionId="s1" />),
      )
      expect(host.textContent).toBe('')
      pluginUiHostFor('surface-late').sessionSurfaces.register({
        surface: 'late.surface.probe',
        Component: ({ sessionId }: { sessionId: string | null }) => <p>poller for {sessionId}</p>,
      } as never)
      await act(async () => flushRegistryChanges())
      expect(host.textContent).toBe('poller for s1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      removePluginUiContributions('surface-late')
      __setRegistryFlushScheduler(null)
    }
  })
})
