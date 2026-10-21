import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'

import { registerDom } from '@localixai/kit/testing/dom'
import { consumeSettingsNav } from '@/shared/lib/settingsNavBus'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())
beforeEach(() => consumeSettingsNav())
afterEach(() => consumeSettingsNav())

describe('UiNavigationActionPart', () => {
  test('renders one compact button and navigates only after the user clicks it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { subscribeSettingsNav } = await import('@/shared/lib/settingsNavBus')
    const { ItemView } = await import('@/entities/chat/ui/tool-parts/ItemView')
    const item: ToolCallItem = {
      id: 'ui-1',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'tc-ui-1',
      // The dispatcher recognizes the standard output shape, not this tool name.
      name: 'plugin_navigation',
      input: {},
      activeVerb: 'Offering destination',
      output: {
        type: 'ui.navigate',
        uri: 'localix://ui/settings/tools/tool-loops?scope=PRJ-7',
        label: 'Open loops settings',
        description: 'Enable loops if you want to use it.',
      },
    }
    const targets: Array<{ tab: string; anchor?: string; scope?: string }> = []
    const unsubscribe = subscribeSettingsNav((target) => targets.push(target))
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <ItemView item={item} />
          </MemoryRouter>,
        ),
      )

      const buttons = host.querySelectorAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].textContent).toContain('Open loops settings')
      expect(buttons[0].className).toContain('h-[var(--chrome-control-sm)]')
      expect(buttons[0].getAttribute('title')).toBeNull()
      expect(buttons[0].getAttribute('data-tooltip-trigger')).toBe('true')
      expect(targets).toEqual([])

      await act(async () => buttons[0].click())
      expect(targets).toEqual([{ tab: 'tools', anchor: 'tool-loops', scope: 'PRJ-7' }])
    } finally {
      unsubscribe()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('renders ranked suggestions as compact buttons in a horizontal scroll strip', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { subscribeSettingsNav } = await import('@/shared/lib/settingsNavBus')
    const { registerUiLocation, unregisterUiLocation } =
      await import('@/shared/contrib/uiLocations')
    const { ItemView } = await import('@/entities/chat/ui/tool-parts/ItemView')
    const firstId = 'test.ui-suggestions.plugins'
    const secondId = 'test.ui-suggestions.capabilities'
    const firstUri = 'localix://ui/settings/test-suggestions-plugins'
    const secondUri = 'localix://ui/sidebar/test-suggestions-capabilities'
    const targets: string[] = []
    let unsubscribe = () => {}
    const host = document.createElement('div')
    const root = createRoot(host)

    expect(
      registerUiLocation({
        id: firstId,
        uri: firstUri,
        title: 'Plugins',
        description: 'Open installed plugin settings',
        effect: 'read',
        surface: 'settings',
        exposure: {},
        resolve: () => ({ kind: 'settings', tab: 'plugins' }),
      }),
    ).toBe(true)
    expect(
      registerUiLocation({
        id: secondId,
        uri: secondUri,
        title: 'Capabilities',
        description: 'Open the workspace capability inventory',
        effect: 'read',
        surface: 'sidebar',
        exposure: {},
        resolve: () => ({ kind: 'settings', tab: 'agents' }),
      }),
    ).toBe(true)

    const item: ToolCallItem = {
      id: 'ui-suggestions',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'tc-ui-suggestions',
      name: 'localix_ui',
      input: { action: 'find', query: 'plugins' },
      activeVerb: 'Finding destination',
      output: {
        type: 'ui.navigate.suggestions',
        suggestions: [
          {
            type: 'ui.navigate',
            uri: firstUri,
            label: 'Plugins',
            description: 'Open installed plugin settings',
          },
          {
            type: 'ui.navigate',
            uri: secondUri,
            label: 'Capabilities',
            description: 'Open the workspace capability inventory',
          },
        ],
      },
    }

    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <ItemView item={item} />
          </MemoryRouter>,
        ),
      )
      unsubscribe = subscribeSettingsNav((target) => targets.push(String(target.tab)))
      targets.length = 0

      const card = host.querySelector('[data-ui-navigation-suggestions]')
      expect(card).not.toBeNull()
      expect(card?.className).toContain('overflow-x-auto')
      expect(card?.className).toContain('overflow-y-hidden')
      expect(card?.className).toContain('scrollbar-thin')
      expect(card?.querySelector('ul')?.className).toContain('w-max')

      const buttons = card?.querySelectorAll('button')
      expect(buttons).toHaveLength(2)
      expect(buttons?.[0]?.textContent).toContain('Plugins')
      expect(buttons?.[1]?.textContent).toContain('Capabilities')
      expect(buttons?.[0]?.className).toContain('h-[var(--chrome-control-sm)]')
      expect(card?.textContent).not.toContain('localix_ui')
      expect(card?.querySelector('pre')).toBeNull()
      expect(targets).toEqual([])

      await act(async () => buttons?.[1]?.click())
      expect(targets).toEqual(['agents'])
    } finally {
      await act(async () => root.unmount())
      unsubscribe()
      unregisterUiLocation(firstId)
      unregisterUiLocation(secondId)
      host.remove()
    }
  })

  test('opens the real Plugins settings surface from a find suggestion', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { subscribeSettingsNav } = await import('@/shared/lib/settingsNavBus')
    const { registerUiLocation, unregisterUiLocation } =
      await import('@/shared/contrib/uiLocations')
    const { default: pluginsSurface } =
      await import('@/features/settings/ui/PluginsSettings.surface')
    const { ItemView } = await import('@/entities/chat/ui/tool-parts/ItemView')
    const targets: Array<{ tab: string; scope?: string }> = []
    let unsubscribe = () => {}
    const host = document.createElement('div')
    const root = createRoot(host)
    const item: ToolCallItem = {
      id: 'ui-plugins-suggestion',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'tc-ui-plugins-suggestion',
      name: 'localix_ui',
      input: { action: 'find', query: 'plugin settings enable plugins' },
      activeVerb: 'Finding destination',
      output: {
        type: 'ui.navigate.suggestions',
        suggestions: [
          {
            type: 'ui.navigate',
            uri: 'localix://ui/settings/plugins?scope=project-a',
            label: 'Plugins',
            description: 'Open installed plugin settings',
          },
        ],
      },
    }

    expect(registerUiLocation(pluginsSurface)).toBe(true)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <ItemView item={item} />
          </MemoryRouter>,
        ),
      )
      unsubscribe = subscribeSettingsNav((target) =>
        targets.push({ tab: String(target.tab), scope: target.scope }),
      )
      targets.length = 0

      const button = host.querySelector('button')
      expect(button?.textContent).toContain('Open Plugins')
      expect(targets).toEqual([])

      await act(async () => button?.click())
      expect(targets).toEqual([{ tab: 'plugins', scope: 'project-a' }])
    } finally {
      unsubscribe()
      await act(async () => root.unmount())
      unregisterUiLocation(pluginsSurface.id)
      host.remove()
    }
  })

  test('reacts to live plugin availability without opening the destination', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { setEnabledPluginNames } = await import('@/shared/contrib/pluginActivation')
    const { registerUiLocation, unregisterUiLocation } =
      await import('@/shared/contrib/uiLocations')
    const { ItemView } = await import('@/entities/chat/ui/tool-parts/ItemView')
    const locationId = 'test.ui-action.activation'
    const uri = 'localix://ui/plugin/test-activation'
    const item: ToolCallItem = {
      id: 'ui-plugin-activation',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'tc-ui-plugin-activation',
      name: 'plugin_navigation',
      input: {},
      activeVerb: 'Offering destination',
      output: {
        type: 'ui.navigate',
        uri,
        label: 'Open plugin surface',
      },
    }
    const host = document.createElement('div')
    const root = createRoot(host)

    expect(
      registerUiLocation({
        id: locationId,
        uri,
        title: 'Plugin surface',
        pluginName: 'test-ui-action-plugin',
        effect: 'read',
        surface: 'plugin',
        exposure: {},
        resolve: () => ({ kind: 'settings', tab: 'plugins' }),
      }),
    ).toBe(true)
    setEnabledPluginNames(new Set())

    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <ItemView item={item} />
          </MemoryRouter>,
        ),
      )

      const button = host.querySelector('button')
      expect(button?.disabled).toBe(true)
      const disabledHint = host.querySelector<HTMLElement>('[data-disabled-tooltip-anchor]')
      expect(disabledHint?.tabIndex).toBe(0)
      expect(disabledHint?.getAttribute('aria-label')).toBe(
        'Open plugin surface. This destination is not currently available',
      )
      expect(button?.getAttribute('title')).toBeNull()

      await act(async () => setEnabledPluginNames(new Set(['test-ui-action-plugin'])))
      expect(host.querySelector('button')?.disabled).toBe(false)
      expect(host.querySelector('[data-disabled-tooltip-anchor]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      setEnabledPluginNames(null)
      unregisterUiLocation(locationId)
      host.remove()
    }
  })
})
