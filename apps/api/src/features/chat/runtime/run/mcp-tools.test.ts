import { afterEach, expect, spyOn, test } from 'bun:test'
import {
  createMcpClientManager,
  mcpClientManager,
  type McpGatherResult,
} from '../../../mcp/client-manager'
import type { McpClientLike } from '../../../mcp/mcp-wire'
import type { McpServerRecord } from '../../../mcp/repository'
import { UNDECIDED, type AvailabilityReader } from '../../../capabilities/availability'
import type { SessionRecord } from '../../repository'
import { resolveMcpTools } from './mcp-tools'
import type { RunEnv } from './types'

const empty: McpGatherResult = {
  tools: [],
  servers: [],
  serverByTool: {},
  instructions: [],
  resourceServers: [],
}
let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

function resolve(gathered: McpGatherResult, pluginServers: Array<{ name: string }>) {
  const gather = spyOn(mcpClientManager, 'gather').mockResolvedValue(gathered)
  restore = () => gather.mockRestore()
  const result = resolveMcpTools({
    env: { mcpRepo: { listForScope: async () => [] } } as unknown as RunEnv,
    userId: 'u',
    session: { id: 's', projectId: 'p' } as SessionRecord,
    pluginMcpServers: pluginServers as never,
    defaultCwd: '/work',
    availability: UNDECIDED,
  })
  return { gather, result }
}

test('a run with no MCP servers left still gathers, so the last ones are stopped', async () => {
  // Disabling the plugin whose servers were the last in scope: the empty gather is what drops
  // the scope's servers and evicts their stdio clients (mcp-gather.ts).
  const { gather, result } = resolve(empty, [])
  expect((await result).tools).toEqual([])
  expect(gather).toHaveBeenCalledTimes(1)
  expect(gather.mock.calls[0][0]).toEqual([])
  expect(gather.mock.calls[0][1]).toMatchObject({ scope: 'u:p:/work:' })
})

test('a server that failed to connect is named to the model with its error', async () => {
  const { result } = resolve(
    {
      ...empty,
      servers: [
        { name: 'kit_broken', ok: false, toolCount: 0, cached: false, error: 'spawn ENOENT' },
        { name: 'kit_cold', ok: false, toolCount: 0, cached: false, pending: true },
      ],
    },
    [{ name: 'kit_broken' }, { name: 'kit_cold' }],
  )
  expect((await result).inventory).toEqual([
    { server: 'kit_broken', tools: [], failed: true, error: 'spawn ENOENT' },
    { server: 'kit_cold', tools: [], pending: true },
  ])
})

test('a chat whose agent reaches no server leaves another chat’s servers running', async () => {
  // Two chats in one project and cwd, under different agents. Chat B's agent may reach no MCP
  // server, so its gather is empty; it must not drop chat A's scope and stop A's live client.
  const clients: Array<{ closed: boolean }> = []
  const manager = createMcpClientManager({
    connect: async () => {
      const client = {
        closed: false,
        listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }),
        callTool: async () => ({ content: [] }),
        close: async () => void (client.closed = true),
      }
      clients.push(client)
      return client as unknown as McpClientLike
    },
  })
  const gather = spyOn(mcpClientManager, 'gather').mockImplementation((servers, options) =>
    manager.gather(servers, options),
  )
  restore = () => gather.mockRestore()
  const server = {
    id: 'srv',
    userId: 'u',
    projectId: 'p',
    name: 'echo',
    transport: 'stdio',
    config: { command: ['echo-server'] },
  } as unknown as McpServerRecord
  const denyAll: AvailabilityReader = { effectFor: () => 'deny' }
  const turn = (agentId: string, availability: AvailabilityReader) =>
    resolveMcpTools({
      env: { mcpRepo: { listForScope: async () => [server] } } as unknown as RunEnv,
      userId: 'u',
      session: { id: `chat-${agentId}`, projectId: 'p' } as SessionRecord,
      pluginMcpServers: [],
      defaultCwd: '/work',
      availability,
      agentId,
    })

  expect((await turn('a', UNDECIDED)).tools.length).toBeGreaterThan(0)
  await turn('b', denyAll)
  await Promise.resolve()
  expect(clients).toHaveLength(1)
  expect(clients[0].closed).toBe(false)
  await manager.disposeAll()
})
