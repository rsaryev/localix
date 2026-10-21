import type { McpServerRecord } from '@/shared/api/contracts'
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { McpServersData } from './useMcpServers'

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

describe('MCP runtime availability mutations', () => {
  test('an immediate no-project run waits for an in-flight global server toggle', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { useMcpServers } = await import('./useMcpServers')
    const { waitForRuntimeCapabilities } =
      await import('@/shared/contrib/runtimeCapabilityReadiness')

    const server = {
      id: 'mcp-global',
      name: 'Global tools',
      projectId: '',
      enabled: false,
      config: {},
    } as unknown as McpServerRecord
    const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
    const { __resetPluginContrib } = await import('@/shared/contrib/enabledPlugins')
    __resetPluginContrib()
    __resetCapabilityCache()
    // The rows arrive in the scope's ONE capability document, not from a list endpoint
    // of their own — the toggle's runtime barrier is what this test pins, and it is
    // unchanged by where the row came from.
    const document1 = {
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
      mcp: [server],
      skills: [],
      grammar: { kinds: [], effects: [], classes: [], examples: [] },
      themes: [],
    }
    const list = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue(
      document1 as never,
    )
    let release!: () => void
    // The rule write answers with the scope's new document — there is no separate
    // "set enabled" call any more, and no follow-up read.
    const save = spyOn(backendClient, 'applyCapabilityRules').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ...document1, revision: 2, mcp: [{ ...server, enabled: true }] } as never)
        }),
    )
    const probe = spyOn(backendClient, 'testMcpServer').mockResolvedValue({
      ok: true,
      tools: [],
    })
    const latest: { current: McpServersData | null } = { current: null }

    function Harness() {
      latest.current = useMcpServers('')
      return null
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(
        <WorkItemVisibilityProvider visible>
          <Harness />
        </WorkItemVisibilityProvider>,
      )
      await settle()
    })
    expect(latest.current?.servers).toHaveLength(1)

    let toggle!: Promise<void>
    await act(async () => {
      toggle = latest.current!.toggleEnabled(latest.current!.servers[0]!)
      await Promise.resolve()
    })
    // A switch is a rule: the server is addressed by NAME, like every other kind.
    expect(save).toHaveBeenCalledWith({
      projectId: null,
      agentId: null,
      changes: [{ action: 'mcp:Global tools', resource: '*', effect: 'allow' }],
    })

    const barrier = waitForRuntimeCapabilities(null)
    expect(barrier).not.toBeNull()
    let ready = false
    void barrier!.then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)

    release()
    await act(async () => {
      await toggle
      await barrier
    })
    expect(ready).toBe(true)

    await act(async () => root.unmount())
    list.mockRestore()
    save.mockRestore()
    probe.mockRestore()
  })
})
