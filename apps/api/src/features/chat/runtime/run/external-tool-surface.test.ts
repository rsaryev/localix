import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'
import { BUILTIN_TEAM } from '../../../agents/builtin-team'
import { builtinAgentPreset } from '../../../capabilities/builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from '../../../capabilities/resolve'
import { applyPermissionMode } from '../../../capabilities/permission-mode-policy'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { createPermissionGate } from '../../../agent-core/permission-engine'
import { externalToolSurface } from './external-tool-surface'

const external: AgentTool = {
  name: 'mcp_records_read',
  description: 'Read a record',
  activeVerb: 'Reading',
  inputSchema: z.object({ record: z.string() }),
  permissionResources: (input) => [(input as { record: string }).record],
  mutates: false,
  execute: async () => ({ content: '' }),
}
const profile = resolveRunProfile({ sessionKind: 'chat' })
const surface = (rules: Parameters<typeof composeCapabilities>[0], tools = [external]) =>
  externalToolSurface({
    tools,
    profile,
    capabilities: composeCapabilities(rules),
    disabledTools: [],
  })

describe('dynamic tools and agent presets', () => {
  test.each(BUILTIN_TEAM.filter((agent) => agent.kind !== 'human').map((agent) => agent.handle))(
    '%s applies its roster in every mode',
    (handle) => {
      for (const mode of ['default', 'plan', 'bypass', 'autonomous'] as const) {
        const result = surface(applyPermissionMode(mode, builtinAgentPreset(handle)).rules)
        expect(result.tools.map((tool) => tool.name)).toEqual(
          handle === 'localix' ? [external.name] : [],
        )
        expect(result.ledger.get(external.name)?.state).toBe(
          handle === 'localix' ? 'live' : 'withheld',
        )
      }
    },
  )

  test('a permitted argument exception keeps the descriptor and the gate narrows its calls', async () => {
    const capabilities = composeCapabilities([
      { action: 'tool:*', resource: '*', effect: 'deny' },
      { action: `tool:${external.name}`, resource: 'record:public', effect: 'allow' },
    ])
    const result = externalToolSurface({
      tools: [external],
      profile,
      capabilities,
      disabledTools: [],
    })
    expect(result.tools).toEqual([external])
    const gate = createPermissionGate({
      rules: projectCapabilities(capabilities, NO_ROSTERS).permissions,
      toolsByName: new Map([[external.name, external]]),
      hostRoots: [],
    })
    expect(
      (
        await gate({
          toolCallId: 'public',
          toolName: external.name,
          input: { record: 'record:public' },
        })
      )?.block,
    ).not.toBe(true)
    expect(
      await gate({
        toolCallId: 'private',
        toolName: external.name,
        input: { record: 'record:private' },
      }),
    ).toMatchObject({ block: true })
  })

  test('host and model limitations precede any policy grant', () => {
    const tools = [{ ...external, requiresModelInput: ['image'] }]
    const result = externalToolSurface({
      tools,
      profile,
      capabilities: composeCapabilities([]),
      disabledTools: [],
      modelInput: ['text'],
    })
    expect(result.tools).toEqual([])
    expect(result.ledger.get(external.name)).toMatchObject({
      state: 'withheld',
      reason: { layer: 'model' },
    })
  })

  test('a closed worker cannot acquire a dynamic tool by policy alone', () => {
    const result = externalToolSurface({
      tools: [external],
      profile: resolveRunProfile({ sessionKind: 'job' }),
      capabilities: composeCapabilities([]),
      disabledTools: [],
    })
    expect(result.tools).toEqual([])
    expect(result.ledger.get(external.name)).toMatchObject({
      state: 'withheld',
      reason: { layer: 'shape' },
    })
  })
})
