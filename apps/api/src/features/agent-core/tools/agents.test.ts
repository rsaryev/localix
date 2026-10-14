import { describe, expect, test } from 'bun:test'
import { agentAuthoredBlueprintSchema } from '@localixai/agent/agents'
import { createAgentsTool, classifyAgentsCall, type CatalogAgent } from './agents'
import { evaluate } from '../permission-engine'
import { extractCallFacts } from '../permission-facts'

const agent: CatalogAgent = {
  id: 'native:one',
  handle: 'database-reviewer',
  description: 'Reviews migrations',
  scope: 'project',
  enabled: true,
  canJoinConversation: true,
  leadershipPriority: 0,
}
/** What the model writes — snake_case on the wire. */
const wire = {
  handle: agent.handle,
  description: agent.description,
  instructions: 'Review.',
  leadership_priority: 0,
}
/** What the registry receives. */
const blueprint = {
  handle: agent.handle,
  description: agent.description,
  instructions: 'Review.',
  leadershipPriority: 0,
}

describe('agent catalog tool', () => {
  test('creates a team with explicit priorities and reports individual successes and errors', async () => {
    const calls: unknown[] = []
    const tool = createAgentsTool({
      list: async () => [agent],
      create: async (...args) => {
        calls.push(args)
        return {
          created: [agent],
          errors: [{ index: 1, handle: 'qa', code: 'agent_exists', message: 'Already exists' }],
        }
      },
    })
    const inputs = [wire, { ...wire, handle: 'qa', leadership_priority: -1 }]
    const result = await tool.execute('call-1', { action: 'create', agents: inputs })
    expect(calls).toEqual([
      ['call-1', [blueprint, { ...blueprint, handle: 'qa', leadershipPriority: -1 }]],
    ])
    expect(JSON.parse(String(result.content))).toMatchObject({
      status: 'partial',
      created: [agent],
      errors: [{ handle: 'qa' }],
    })
    // A result reports what happened; how to bring the agents in is the tool description's.
    expect(String(result.content)).not.toContain('next')
    expect(result.isError).toBeUndefined()
    expect(tool.inputSchema.safeParse({ action: 'delegate', tasks: [] }).success).toBe(false)
  })

  test('empty, oversized, duplicate, missing priority or injected batches fail before writes', async () => {
    let writes = 0
    const tool = createAgentsTool({
      list: async () => [agent],
      create: async () => {
        writes++
        return { created: [agent], errors: [] }
      },
    })
    for (const field of [
      'permissions',
      'role',
      'projectId',
      'id',
      'enabled',
      'modelPreference',
      'context',
      'leadershipPriority',
    ]) {
      await expect(
        tool.execute('call', { action: 'create', agents: [{ ...wire, [field]: 'injected' }] }),
      ).rejects.toThrow()
    }
    const { leadership_priority: _priority, ...missing } = wire
    for (const agents of [
      [],
      [missing],
      [wire, wire],
      Array.from({ length: 9 }, (_, i) => ({ ...wire, handle: `a${i}` })),
      [{ ...wire, leadership_priority: 3 }],
      [{ ...wire, leadership_priority: 0.5 }],
    ]) {
      await expect(tool.execute('call', { action: 'create', agents } as never)).rejects.toThrow()
    }
    expect(writes).toBe(0)
    for (const handle of ['user', 'all', '../escape'])
      expect(agentAuthoredBlueprintSchema.safeParse({ ...blueprint, handle }).success).toBe(false)
  })

  test('failed batches are errors; successful IDs retain availability and priority', async () => {
    const tool = createAgentsTool({
      list: async () => [agent],
      create: async () => ({
        created: [],
        errors: [
          { index: 0, handle: agent.handle, code: 'agent_exists', message: 'Already exists' },
        ],
      }),
    })
    const result = await tool.execute('call', { action: 'create', agents: [wire] })
    expect(result.isError).toBe(true)
    expect(JSON.parse(String(result.content)).status).toBe('failed')
  })

  test('list reads in parallel and can be allowed while creation is denied; there is no get', async () => {
    const tool = createAgentsTool({
      list: async () => [agent],
      create: async () => ({ created: [agent], errors: [] }),
    })
    expect(tool.inputSchema.safeParse({ action: 'get', agent: 'qa' }).success).toBe(false)
    const rules = [
      { permission: 'agents', pattern: '*', action: 'deny' as const },
      { permission: 'agents', pattern: 'list', action: 'allow' as const },
    ]
    const read = { action: 'list' } as const
    const create = { action: 'create', agents: [wire] }
    for (const [input, expected] of [
      [read, 'allow'],
      [create, 'deny'],
    ] as const) {
      expect(
        evaluate(
          rules,
          { name: 'agents', ...classifyAgentsCall(input) },
          extractCallFacts('agents', input, undefined, tool),
        ).action,
      ).toBe(expected)
    }
    // The schema names a role, not the task that created it (LOCALIX-168).
    expect(JSON.stringify(tool.inputSchema.toJSONSchema?.())).toContain('reusable in any project')
    expect(tool.executionModeFor?.(read)).toBe('parallel')
    expect(tool.executionModeFor?.(create)).toBe('sequential')
    expect(JSON.parse(String((await tool.execute('read', read)).content))).toEqual({
      agents: [agent],
    })
  })
})
