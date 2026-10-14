import { afterAll, beforeAll, expect, test } from 'bun:test'
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

test('the status bar omits CLI launchers even when agents are installed', async () => {
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
    expect(order).toEqual(['reset-layout'])
    await React.act(async () =>
      root.render(
        <SWRConfig value={config}>
          <Probe available />
        </SWRConfig>,
      ),
    )
    expect(order).toEqual(['reset-layout', 'keep-awake'])
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
