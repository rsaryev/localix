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

/**
 * A plugin rebuild replaces its registrations under a tab that is already open. The body is a
 * memo boundary on props a rebuild never changes, so before this the visible tab kept running the
 * Component of the module the rebuild had just replaced — the agent reported "swapped in place"
 * while the person clicked the old code — and a tab that had crashed stayed crashed after the fix.
 */
describe('an open plugin tab follows a plugin UI swap', () => {
  test('renders the new Component, recovers from a crash, and leaves other plugins mounted', async () => {
    const { act, useEffect } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { WorkItemBody } = await import('./registry')
    const { workItemKindRegistry } = await import('@/shared/contrib/uiContrib')
    const { announcePluginUiChanged, restorePluginContribFrame, __resetPluginContrib } =
      await import('@/shared/contrib/enabledPlugins')
    const { flushRegistryChanges } = await import('@/shared/contrib/registryChanges')

    restorePluginContribFrame(null, {
      revision: 1,
      enabledNames: ['swap-probe', 'bystander'],
      plugins: [],
      views: [],
      tools: null,
    })
    let bystanderMounts = 0
    function Bystander() {
      useEffect(() => {
        bystanderMounts += 1
      }, [])
      return <p>bystander</p>
    }
    const register = (Component: () => React.ReactNode) =>
      workItemKindRegistry.register({
        kind: 'swap-probe:view',
        pluginName: 'swap-probe',
        Component,
      } as never)
    register(() => {
      throw new Error('first build crashes')
    })
    workItemKindRegistry.register({
      kind: 'bystander:view',
      pluginName: 'bystander',
      Component: Bystander,
    } as never)

    const probe = { id: 'swap-probe:view', title: 'Probe', kind: 'swap-probe:view' }
    const other = { id: 'bystander:view', title: 'Other', kind: 'bystander:view' }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const errors = console.error
    console.error = () => {}
    try {
      await act(async () =>
        root.render(
          <>
            <WorkItemBody item={probe} visible focused resolvedTheme="dark" />
            <WorkItemBody item={other} visible focused={false} resolvedTheme="dark" />
          </>,
        ),
      )
      expect(host.textContent).toContain('could not render')

      // The rebuild: the owner's registrations go, the new module's arrive, the runtime announces.
      workItemKindRegistry.removeOwner('swap-probe')
      register(() => <p>second build</p>)
      // The announcement is coalesced to the next frame; flush it rather than wait for one.
      await act(async () => {
        announcePluginUiChanged()
        flushRegistryChanges()
      })

      expect(host.textContent).toContain('second build')
      expect(host.textContent).not.toContain('could not render')
      // Another plugin's tab re-renders but is not remounted: its state survives someone
      // else's rebuild.
      expect(host.textContent).toContain('bystander')
      expect(bystanderMounts).toBe(1)
    } finally {
      console.error = errors
      await act(async () => root.unmount())
      host.remove()
      workItemKindRegistry.removeOwner('swap-probe')
      workItemKindRegistry.removeOwner('bystander')
      __resetPluginContrib()
    }
  })
})
