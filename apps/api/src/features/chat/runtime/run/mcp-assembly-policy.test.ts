import { afterEach, expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'
import { mcpClientManager, type McpGatherResult } from '../../../mcp/client-manager'
import { composeCapabilities } from '../../../capabilities/resolve'
import { UNDECIDED } from '../../../capabilities/availability'
const specialistRules = [
  { action: 'tool:*', resource: '*', effect: 'deny' as const },
  { action: 'tool:read', resource: '*', effect: 'allow' as const },
  { action: 'tool:mcp_resources', resource: '*', effect: 'allow' as const },
]
import { resolveRunProfile } from '../../../agent-core/run-shape'
import type { ToolLedger } from '../../../agent-core/tool-ledger'
import { assembleRunTools, type AssembleRunToolsOptions } from './tool-assembly'

const tool = (name: string): AgentTool => ({
  name,
  description: name,
  activeVerb: 'Reading',
  inputSchema: z.object({}),
  mutates: false,
  execute: async () => ({ content: 'ok' }),
})
const candidate = tool('mcp_records_read')
const gather: McpGatherResult = {
  tools: [candidate],
  servers: [{ name: 'records', ok: true, toolCount: 1, cached: false }],
  serverByTool: { [candidate.name]: 'records' },
  instructions: [{ server: 'records', text: 'Read records.' }],
  resourceServers: [],
}
let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

async function assemble(
  input: {
    rules?: Parameters<typeof composeCapabilities>[0]
    activated?: string[]
    primary?: AgentTool[]
    ledger?: ToolLedger
    gathered?: McpGatherResult
  } = {},
) {
  const mocked = spyOn(mcpClientManager, 'gather').mockResolvedValue(input.gathered ?? gather)
  restore = () => mocked.mockRestore()
  let visibleLedger: ToolLedger | undefined
  const primary = input.primary ?? [tool('read')]
  const result = await assembleRunTools({
    env: { mcpRepo: { listForScope: async () => [{ name: 'records' }] } },
    userId: 'u',
    session: { id: 's', projectId: 'p', activatedTools: input.activated ?? [] },
    agentProfile: resolveRunProfile({ sessionKind: 'chat' }),
    runtimeTools: {
      tools: primary,
      ledger: input.ledger ?? new Map(primary.map((entry) => [entry.name, { state: 'live' }])),
      setLedger: (ledger: ToolLedger) => {
        visibleLedger = ledger
      },
    },
    loadedPlugins: { tools: [], hooks: [], mcpServers: [] },
    ccHooks: { active: false },
    defaultCwd: '/tmp',
    disabledTools: [],
    availability: UNDECIDED,
    capabilities: composeCapabilities(input.rules ?? []),
    backgroundToolNames: new Set(),
  } as unknown as AssembleRunToolsOptions)
  return { ...result, visibleLedger }
}

test('a specialist denies gathered MCP descriptors before wire, preflight and instructions', async () => {
  const result = await assemble({ rules: specialistRules })
  expect(result.tools.map((entry) => entry.name)).not.toContain(candidate.name)
  expect(result.preflightTools.map((entry) => entry.name)).not.toContain(candidate.name)
  expect(result.ledger.get(candidate.name)).toMatchObject({
    state: 'withheld',
    reason: { layer: 'policy' },
  })
  expect(result.mcpInstructions).toEqual([])
  expect(result.mcpInventory).toEqual([])
  expect(result.visibleLedger).toEqual(result.ledger)
})

test('a deferred MCP descriptor becomes live after activation and updates the configure ledger', async () => {
  const first = await assemble()
  expect(first.ledger.get(candidate.name)).toMatchObject({ state: 'deferred' })
  expect(first.preflightTools.map((entry) => entry.name)).toContain(candidate.name)
  restore?.()
  const next = await assemble({ activated: [candidate.name] })
  expect(next.tools.map((entry) => entry.name)).toContain(candidate.name)
  expect(next.ledger.get(candidate.name)).toEqual({ state: 'live' })
  expect(next.visibleLedger).toEqual(next.ledger)
  expect(next.deferredToolNames).toEqual([])
})

test('a rejected MCP namespace collision cannot defer or relabel the primary tool', async () => {
  const primary = tool(candidate.name)
  const result = await assemble({ primary: [primary] })
  expect(result.tools.map((entry) => entry.name)).toEqual([primary.name])
  expect(result.sourceByTool.has(primary.name)).toBe(false)
  expect(result.ledger.get(primary.name)).toEqual({ state: 'live' })
  expect(result.mcpInstructions).toEqual([])
})

test('a resource provider fills an empty optional core port in the canonical ledger', async () => {
  const result = await assemble({
    rules: specialistRules,
    gathered: { ...gather, tools: [], serverByTool: {}, resourceServers: ['records'] },
    ledger: new Map([
      [
        'mcp_resources',
        {
          state: 'withheld',
          reason: { layer: 'authority', kind: 'missing', capability: 'mcp_resources' },
        },
      ],
    ]),
  })
  expect(result.tools.map((entry) => entry.name)).toContain('mcp_resources')
  expect(result.preflightTools.map((entry) => entry.name)).toContain('mcp_resources')
  expect(result.ledger.get('mcp_resources')).toEqual({ state: 'live' })
  expect(result.visibleLedger).toEqual(result.ledger)
})
