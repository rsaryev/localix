import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

/** An empty but STRUCTURALLY COMPLETE snapshot: these tests assert when it is fetched, never what it holds. */
const EMPTY_CAPABILITY_SNAPSHOT = {
  revision: 1,
  scope: { projectId: '', sessionId: null },
  plugins: [],
  tools: {
    enabled: [],
    disabled: [],
    catalog: [],
    categoryLabels: {},
    mcp: [],
    mcpUnprobedServers: [],
  },
  views: [],
  panels: [],
  agents: [],
  commands: [],
  mcp: [],
} as never

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('warm-hidden Settings data sources', () => {
  // Both stores that can answer a capability read are process-global on purpose — that
  // is what makes one document serve every surface. These tests count REQUESTS, so
  // they start from a cold client: otherwise an earlier test's document answers here
  // and the fetch under test never happens.
  beforeEach(async () => {
    // And from spies nobody restored: `spyOn` over an already-spied method returns the SAME spy,
    // so an earlier file's calls on the one process-wide `backendClient` would be counted below
    // as calls this test provoked. These tests count requests, so that reads as a warm-hidden
    // surface fetching when it must not.
    mock.restore()
    const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
    const { __resetPluginContrib } = await import('@/shared/contrib/enabledPlugins')
    __resetPluginContrib()
    __resetCapabilityCache()
  })

  test('capability registries and MCP probes wait until the work item is selected', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { useAgents } = await import('@/features/settings/model/useAgents')
    const { useMcpServers } = await import('@/features/settings/model/useMcpServers')
    const { usePlugins } = await import('@/features/settings/model/usePlugins')
    const { useSkills } = await import('@/features/settings/model/useSkills')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')

    // Skills have no list endpoint of their own any more — the catalog is in the
    // document below. What the Skills screen still reads for itself is CURATOR data:
    // pins, usage, archives, which describe how a skill has been used.
    const curator = spyOn(backendClient, 'listCuratorSkills').mockResolvedValue([])
    // Plugins, agents and MCP servers are no longer three endpoints — they arrive in
    // the scope's ONE capability document, which is what stops them from disagreeing.
    // The laziness under test is the same; the call that witnesses it moved, and the
    // fan-out it replaced is asserted below.
    const snapshot = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue({
      ...(EMPTY_CAPABILITY_SNAPSHOT as object),
      mcp: [{ id: 'mcp-1', name: 'Example', enabled: true, config: {} }],
    } as never)
    // Agents, agent providers and MCP servers no longer HAVE list endpoints of their
    // own — they are fields of the document above.
    const probe = spyOn(backendClient, 'testMcpServer').mockResolvedValue({
      ok: true,
      tools: [],
    })

    function Registries() {
      useSkills('')
      usePlugins('')
      useAgents('')
      useMcpServers('')
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Registries />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(curator).toHaveBeenCalledTimes(0)
    expect(snapshot).toHaveBeenCalledTimes(0)
    expect(probe).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(curator).toHaveBeenCalledTimes(1)
    // FIVE registries, ONE read between them: plugins, agents, agent providers and MCP
    // servers all project the same document, so they can neither fan out nor disagree.
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    curator.mockRestore()
    snapshot.mockRestore()
    probe.mockRestore()
  })

  test('only the active capability leaf loads after a hidden surface becomes visible', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { CapabilitiesSettings } = await import('@/features/settings/ui/CapabilitiesSettings')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')

    // The Tools and Plugins leaves now read ONE snapshot, so "plugins were not fetched"
    // is no longer a property this test can hold: sharing that document is the point.
    // What IS still worth pinning is that the shared read happens ONCE for the active
    // leaf rather than once per capability leaf — the fan-out this replaced.
    const snapshot = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue(
      EMPTY_CAPABILITY_SNAPSHOT,
    )

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <CapabilitiesSettings activeTab="tools" onTabChange={() => {}} projects={[]} />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(snapshot).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    // The inactive leaves stay quiet.
    // Exactly one shared read for the active leaf — not one per capability tab.
    expect(snapshot).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    snapshot.mockRestore()
  })

  test('secondary Settings viewers defer their automatic reads while warm-hidden', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { effectiveConfigApi } = await import('@/shared/api/effectiveConfigApi')
    const { DiagnosticsSettings } = await import('@/features/settings/ui/DiagnosticsSettings')
    const { MarketplacesPanel } = await import('@/features/settings/ui/MarketplacesPanel')
    const { PreferencesSettings } = await import('@/features/settings/ui/PreferencesSettings')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')

    const projects = spyOn(backendClient, 'listProjects').mockResolvedValue([])
    const markets = spyOn(backendClient, 'listMarketplaces').mockResolvedValue([])
    const config = spyOn(effectiveConfigApi, 'get').mockImplementation(() => new Promise(() => {}))

    function Surface({ visible }: { visible: boolean }) {
      return (
        <MemoryRouter>
          <WorkItemVisibilityProvider visible={visible}>
            <PreferencesSettings />
            <DiagnosticsSettings />
            <MarketplacesPanel />
          </WorkItemVisibilityProvider>
        </MemoryRouter>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(projects).toHaveBeenCalledTimes(0)
    expect(markets).toHaveBeenCalledTimes(0)
    expect(config).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(projects).toHaveBeenCalledTimes(1)
    expect(markets).toHaveBeenCalledTimes(1)
    expect(config).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    projects.mockRestore()
    markets.mockRestore()
    config.mockRestore()
  })
})
