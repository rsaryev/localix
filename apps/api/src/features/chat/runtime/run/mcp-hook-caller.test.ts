import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'
import { mcpClientManager } from '../../../mcp/client-manager'
import { composeCapabilities } from '../../../capabilities/resolve'
import { availabilityOf } from '../../../capabilities/availability'
const specialistRules = [
  { action: 'tool:*', resource: '*', effect: 'deny' as const },
  { action: 'tool:Read', resource: '*', effect: 'allow' as const },
  { action: 'tool:McpResources', resource: '*', effect: 'allow' as const },
]
import { createMcpHookCaller } from './mcp-hook-caller'

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})
function fixture(rules: Parameters<typeof composeCapabilities>[0], disabledTools: string[] = []) {
  const execute = mock(async () => ({ content: 'reviewed' }))
  const tool: AgentTool = {
    name: 'mcp_records_read',
    description: 'Read a record',
    activeVerb: 'Reading',
    inputSchema: z.string(),
    permissionResources: (value) => [String(value)],
    mutates: false,
    execute,
  }
  const gather = spyOn(mcpClientManager, 'gather').mockResolvedValue({
    tools: [tool],
    servers: [],
    serverByTool: { [tool.name]: 'records' },
    instructions: [],
    resourceServers: [],
  })
  restore = () => gather.mockRestore()
  const capabilities = composeCapabilities(rules)
  const call = createMcpHookCaller({
    env: { mcpRepo: { listForScope: async () => [{ name: 'records', config: {} }] } } as never,
    userId: 'u',
    session: { id: 's', sessionKind: 'chat' } as never,
    loadedPlugins: { mcpServers: [] } as never,
    defaultCwd: '/tmp',
    disabledTools,
    availability: availabilityOf(capabilities),
    capabilities,
  })
  return { call, execute, gather }
}

test('an MCP hook cannot bypass a specialist roster or an explicit disabled tool', async () => {
  const role = fixture(specialistRules)
  expect(await role.call('mcp__records__read', 'public')).toEqual({ notConnected: true })
  expect(role.execute).not.toHaveBeenCalled()
  restore?.()
  const disabled = fixture([], ['mcp_records_read'])
  expect(await disabled.call('mcp__records__read', 'public')).toEqual({ notConnected: true })
  expect(disabled.execute).not.toHaveBeenCalled()
})

test('an MCP hook enforces argument denials and questions before executing', async () => {
  const { call, execute, gather } = fixture([
    { action: 'tool:mcp_records_read', resource: 'private', effect: 'deny' },
    { action: 'tool:mcp_records_read', resource: 'approval', effect: 'ask' },
  ])
  expect(await call('mcp__records__read', 'public')).toEqual({ text: 'reviewed', isError: false })
  expect(await call('mcp__records__read', 'private')).toMatchObject({ isError: true })
  expect(await call('mcp__records__read', 'approval')).toMatchObject({ isError: true })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(gather).toHaveBeenCalledTimes(1)
})
