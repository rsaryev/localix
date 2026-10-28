import { afterAll, beforeAll, expect, test } from 'bun:test'
import { tap } from '@/testing/hookProbe'
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
  const order = tap<string[]>()
  function Probe({ available }: { available: boolean }) {
    const actions = useRailActions({
      openSessionId: 'own-chat',
      miniAppViews: [],
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
    order.put(resolveRailAreas(defs, null).status)
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
    expect(order.value).toEqual(['reset-layout'])
    await React.act(async () =>
      root.render(
        <SWRConfig value={config}>
          <Probe available />
        </SWRConfig>,
      ),
    )
    expect(order.value).toEqual(['reset-layout', 'keep-awake'])
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})

test('a mini app rail button draws the glyph its screen registered, not its store tile', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { useRailActions } = await import('./useRailActions')
  const { railViewletRegistry } = await import('@/shared/contrib/uiContrib')
  const { restoreMiniAppContribFrame, __resetMiniAppContrib } =
    await import('@/shared/contrib/enabledMiniApps')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  // The manifest names a store/Dock tile; the rail must not wear it.
  restoreMiniAppContribFrame(null, {
    revision: 1,
    enabledNames: ['git-glyph-app'],
    miniApps: [{ name: 'git-glyph-app', icon: 'store/git-glyph-app/icon.svg' }],
    views: [],
    tools: null,
  })
  setEnabledMiniAppNames(new Set(['git-glyph-app']))
  function GitGlyph({ className }: { className?: string }) {
    return <svg data-glyph="git" className={className} />
  }
  railViewletRegistry.register({
    kind: 'git-glyph-view',
    Icon: GitGlyph,
    label: 'Source Control',
    title: 'Source Control',
    defaultArea: 'top',
    miniAppName: 'git-glyph-app',
  } as never)
  function Probe() {
    const actions = useRailActions({
      openSessionId: 'own-chat',
      miniAppViews: [],
      capabilityScope: 'global',
      keepAwake: { state: null, busy: false, toggle: async () => {} },
      isMobile: false,
      setSidebarOpen: () => {},
      setConfirmKeepAwake: () => {},
    })
    const git = actions.find((action) => action.id === 'viewlet:git-glyph-view')
    const search = actions.find((action) => action.id === 'viewlet:global-search')
    return (
      <>
        <span data-testid="git">{git?.icon}</span>
        <span data-testid="search">{search?.icon}</span>
      </>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await React.act(async () =>
      root.render(
        <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
          <Probe />
        </SWRConfig>,
      ),
    )
    const git = host.querySelector('[data-testid="git"]')!
    const search = host.querySelector('[data-testid="search"]')!
    expect(git.querySelector('img')).toBeNull()
    const glyph = git.querySelector('svg[data-glyph="git"]')
    expect(glyph).not.toBeNull()
    // The same box as every other rail glyph.
    const searchBox = [...search.querySelector('svg')!.classList].filter(
      (name) => !name.startsWith('lucide'),
    )
    expect([...glyph!.classList]).toEqual(searchBox)
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    railViewletRegistry.removeOwner('git-glyph-app')
    __resetMiniAppContrib()
  }
})
