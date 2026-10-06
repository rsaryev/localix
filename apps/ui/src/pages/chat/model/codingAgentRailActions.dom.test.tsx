import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('default status order puts reset and sleep before the coding agents when the toggle loads', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useRailActions } = await import('./useRailActions')
  const { SWRConfig } = await import('swr')
  const { buildRailEntries } = await import('@/widgets/workspace-shell/model/buildRailEntries')
  const { resolveRailAreas } = await import('@/widgets/workspace-shell/model/railLayout')
  let order: string[] = []
  function Probe({ available }: { available: boolean }) {
    const actions = useRailActions({
      openSessionId: 'own-chat',
      pluginViews: [],
      capabilityScope: 'global',
      keepAwake: {
        state: { id: 'keep-awake', title: 'Keep awake', enabled: false, available },
        busy: false,
        toggle: async () => {},
      },
      isMobile: false,
      setSidebarOpen: () => {},
      setConfirmKeepAwake: () => {},
    })
    const { defs } = buildRailEntries({
      railSections: [],
      customizableActions: actions.filter((action) => action.customizable),
      sidebarOpen: false,
      activeSection: null,
      onSectionClick: () => {},
    })
    order = resolveRailAreas(defs, null).status
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const cache = new Map()
  const config = {
    provider: () => cache,
    fallback: {
      'external-agents:installed': [
        { id: 'claude-code', name: 'Claude Code', command: 'claude' },
        { id: 'codex', name: 'Codex', command: 'codex' },
      ],
    },
    revalidateOnMount: false,
    refreshInterval: 0,
  }
  try {
    await React.act(async () =>
      root.render(
        <SWRConfig value={config}>
          <Probe available={false} />
        </SWRConfig>,
      ),
    )
    expect(order).toEqual(['reset-layout', 'coding-agent:claude', 'coding-agent:codex'])
    await React.act(async () =>
      root.render(
        <SWRConfig value={config}>
          <Probe available />
        </SWRConfig>,
      ),
    )
    expect(order).toEqual([
      'reset-layout',
      'keep-awake',
      'coding-agent:claude',
      'coding-agent:codex',
    ])
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})

test('the launch bar exposes only installed commands', async () => {
  const { codingAgentRailActions } = await import('./codingAgentRailActions')
  expect(codingAgentRailActions('own-chat', [])).toEqual([])
  expect(codingAgentRailActions('own-chat', ['codex']).map((action) => action.id)).toEqual([
    'coding-agent:codex',
  ])
})

test('core Claude and Codex controls launch, move, reorder and unpin independently of plugins', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkspaceShell } = await import('@/widgets/workspace-shell')
  const { codingAgentRailActions } = await import('./codingAgentRailActions')
  const { backendClient } = await import('@/shared/api/client')
  const { useGridStore } = await import('@/features/workspace-grid/model')
  const { setEnabledPluginNames } = await import('@/shared/contrib/pluginActivation')
  const { RAIL_ENTRY_DRAG_MIME } = await import('@/widgets/workspace-shell/model/railDrag')
  const key = 'localix_rail_layout'
  const savedLayout = localStorage.getItem(key)
  const savedGrid = useGridStore.getState()
  localStorage.removeItem(key)
  setEnabledPluginNames(new Set())
  let nextId = 0
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockImplementation(async () => ({
    terminalId: `core-cli-${++nextId}`,
  }))
  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  const shell = (sessionId: string | null = 'own-chat') => (
    <WorkspaceShell
      isMobile={false}
      statusSessionId={sessionId}
      sidebarOpen={false}
      activeSectionId={null}
      onSectionChange={() => {}}
      onOpenSidebar={() => {}}
      onCloseSidebar={() => {}}
      onCreateChat={() => {}}
      railSections={[]}
      railActions={codingAgentRailActions(sessionId, ['claude', 'codex'])}
    >
      <div />
    </WorkspaceShell>
  )
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const status = () => host.querySelector<HTMLElement>('[data-status-rail-drop-zone]')!
  const contextAction = async (label: string, action: string) => {
    await React.act(async () =>
      button(label).dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      ),
    )
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (entry) => entry.textContent?.trim() === action,
    )
    expect(item).toBeDefined()
    await React.act(async () => item!.click())
  }
  try {
    await React.act(async () => root.render(shell()))
    for (const label of ['Claude Code', 'Codex']) {
      expect(button(label).closest('[data-status-rail-drop-zone]')).toBe(status())
      expect(button(label).textContent).toBe(label)
      expect(button(label).getAttribute('draggable')).toBe('true')
      expect(button(label).getAttribute('aria-haspopup')).not.toBe('menu')
    }
    expect(button('Claude Code').querySelector('path')?.getAttribute('d')).toStartWith('M25.7146')
    expect(button('Codex').querySelector('path')?.getAttribute('d')).toStartWith('M83.7733')
    await React.act(async () => button('Claude Code').click())
    await React.act(async () => button('Codex').click())
    expect(spawn.mock.calls.map(([input]) => input)).toEqual([
      { sessionId: 'own-chat', command: 'claude' },
      { sessionId: 'own-chat', command: 'codex' },
    ])
    expect(useGridStore.getState().items['terminal:core-cli-1']?.payload?.owned).toBe(true)
    expect(useGridStore.getState().items['terminal:core-cli-2']?.title).toBe('Codex')

    const data = new Map<string, string>()
    const transfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      setDragImage: () => {},
      effectAllowed: 'all',
      dropEffect: 'move',
    }
    const drag = (target: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      target.dispatchEvent(event)
    }
    await React.act(async () => drag(button('Claude Code'), 'dragstart'))
    expect(data.get(RAIL_ENTRY_DRAG_MIME)).toBe('coding-agent:claude')
    const bottom = host.querySelector<HTMLElement>('[data-bottom-rail-drop-zone]')!
    await React.act(async () => drag(bottom, 'dragover'))
    await React.act(async () => drag(bottom, 'drop'))
    expect(button('Claude Code').closest('[data-status-rail-drop-zone]')).toBeNull()
    expect(button('Claude Code').textContent).toBe('') // Vertical rail keeps the logo and tooltip.
    await contextAction('Claude Code', 'Move to status bar')
    expect(button('Claude Code').textContent).toBe('Claude Code')
    await contextAction('Claude Code', 'Move left')
    expect(
      [...status().querySelectorAll<HTMLButtonElement>('[draggable="true"]')].map((entry) =>
        entry.getAttribute('aria-label'),
      ),
    ).toEqual(['Claude Code', 'Codex'])
    await contextAction('Codex', 'Unpin from rail')
    expect(status().textContent).not.toContain('Codex')

    await React.act(async () => root.unmount())
    root = createRoot(host)
    await React.act(async () => root.render(shell('next-chat')))
    expect(status().textContent).toContain('Claude Code')
    expect(status().textContent).not.toContain('Codex')
    await React.act(async () => button('Claude Code').click())
    expect(spawn.mock.calls.at(-1)?.[0]).toEqual({ sessionId: 'next-chat', command: 'claude' })
    await React.act(async () => root.render(shell(null)))
    await React.act(async () => button('Claude Code').click())
    expect(spawn.mock.calls).toHaveLength(3)
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    spawn.mockRestore()
    useGridStore.setState(savedGrid)
    setEnabledPluginNames(null)
    if (savedLayout === null) localStorage.removeItem(key)
    else localStorage.setItem(key, savedLayout)
  }
})
