import { describe, expect, test } from 'bun:test'
import { composeCapabilities } from '../capabilities/resolve'
import { createInvocationRegistry } from '../capabilities/invocation'
import { agentSummarySchema } from './contracts'
import { createAgentInvocationService } from './invocation-service'

const agent = agentSummarySchema.parse({
  record: {
    id: 'native:global:test',
    handle: 'worker',
    description: '',
    instructions: 'Work',
  },
  projectId: '',
  scope: 'global',
  enabled: true,
  invocations: { chat: 'allow', automation: 'ask' },
  source: 'local',
  path: '',
})

describe('shared invocation decisions', () => {
  test('run resolution returns definition and policy from exactly one admitted snapshot', async () => {
    let reads = 0
    const capabilities = composeCapabilities([
      { action: 'tool:write', resource: '*', effect: 'deny' },
    ])
    const service = createAgentInvocationService(async () => {
      reads++
      return { all: [agent], capabilitiesByAgent: new Map([[agent.record.id, capabilities]]) }
    }, createInvocationRegistry())
    const resolved = await service.resolveRunAgent('u', agent.record.id, 'chat')
    expect(reads).toBe(1)
    expect(resolved.status).toBe('allowed')
    if (resolved.status !== 'allowed') throw new Error('Expected an admitted agent')
    expect(resolved.agent.definition).toBe(agent.record)
    expect(resolved.agent.capabilities).toBe(capabilities)
    expect(resolved.agent.approval).toBe('policy')
    expect(resolved.agent.capabilities.allows('tool', 'write')).toBe(false)
    for (const [id, host, project, status] of [
      [agent.record.handle, 'chat', '', 'agent_not_found'],
      [agent.record.id, 'unknown', '', 'unknown_host'],
      [agent.record.id, 'automation', '', 'approval_unsupported'],
      // An installation entry (`projectId: ''`) is visible from any project.
      [agent.record.id, 'chat', 'other', 'allowed'],
    ] as const)
      expect((await service.resolveRunAgent('u', id, host, project)).status).toBe(status)
  })

  test('a definition without its capability snapshot cannot prepare a run', async () => {
    const service = createAgentInvocationService(
      async () => ({ all: [agent], capabilitiesByAgent: new Map() }),
      createInvocationRegistry(),
    )
    expect(await service.resolveRunAgent('u', agent.record.id, 'chat')).toEqual({
      status: 'catalog_incomplete',
    })
  })

  test('each operation reads one catalog snapshot and does not resolve a second definition', async () => {
    let reads = 0
    const service = createAgentInvocationService(async () => {
      reads += 1
      return { all: reads === 1 ? [agent] : [], capabilitiesByAgent: new Map() }
    }, createInvocationRegistry())
    expect(await service.resolveInvocableAgent('u', agent.record.id, 'chat')).toBe(agent.record)
    expect(reads).toBe(1)
    expect((await service.explainAgentAvailability('u', agent.record.id, 'chat')).status).toBe(
      'agent_not_found',
    )
    expect(reads).toBe(2)
    expect(await service.listInvocableAgents('u', 'chat')).toEqual([])
    expect(reads).toBe(3)
  })

  test('an ask cannot imply approval when no host has a pre-run handler', async () => {
    const askedAgent = { ...agent, invocations: { ...agent.invocations, chat: 'ask' as const } }
    const service = createAgentInvocationService(
      async () => ({ all: [askedAgent], capabilitiesByAgent: new Map() }),
      createInvocationRegistry(),
    )
    expect(
      (await service.explainAgentAvailability('u', agent.record.id, 'automation')).status,
    ).toBe('approval_required')
    expect((await service.explainAgentAvailability('u', agent.record.id, 'chat')).status).toBe(
      'approval_required',
    )
    expect(await service.listInvocableAgents('u', 'automation')).toEqual([])
    expect(await service.resolveInvocableAgent('u', agent.record.id, 'automation')).toBeNull()
    expect((await service.resolveRunAgent('u', agent.record.id, 'chat')).status).toBe(
      'approval_unsupported',
    )
  })

  test('one approved ask admits only the unchanged definition and policy snapshot', async () => {
    const askedAgent = { ...agent, invocations: { ...agent.invocations, chat: 'ask' as const } }
    const capabilities = composeCapabilities([])
    let current = askedAgent
    let reads = 0
    const service = createAgentInvocationService(async () => {
      reads++
      return {
        all: [current],
        capabilitiesByAgent: new Map([[agent.record.id, capabilities]]),
      }
    }, createInvocationRegistry())
    const approved = await service.resolveRunAgent(
      'u',
      agent.record.id,
      'chat',
      '',
      async (record) => {
        expect(record.id).toBe(agent.record.id)
        return 'approved'
      },
    )
    expect(approved.status).toBe('allowed')
    if (approved.status !== 'allowed') throw new Error('Expected approved run')
    expect(approved.agent.approval).toBe('user')
    expect(reads).toBe(2)

    expect(
      await service.resolveRunAgent('u', agent.record.id, 'chat', '', async () => 'declined'),
    ).toEqual({ status: 'approval_denied' })
    expect(reads).toBe(3)

    // A card nobody answered is reported apart from one a person refused: the parent that
    // tried to delegate is told which, and they are not the same fact.
    expect(
      await service.resolveRunAgent('u', agent.record.id, 'chat', '', async () => 'unanswered'),
    ).toEqual({ status: 'approval_unanswered' })

    expect(
      await service.resolveRunAgent('u', agent.record.id, 'chat', '', async () => {
        current = { ...askedAgent, record: { ...askedAgent.record, instructions: 'Changed' } }
        return 'approved'
      }),
    ).toEqual({ status: 'approval_changed' })
    expect(reads).toBe(6)
  })

  test.each(['source_disabled', 'policy_pending'] as const)(
    'preserves registration refusal %s instead of reporting policy denial',
    async (unavailableReason) => {
      const service = createAgentInvocationService(
        async () => ({
          all: [{ ...agent, enabled: false, unavailableReason }],
          capabilitiesByAgent: new Map(),
        }),
        createInvocationRegistry(),
      )
      expect((await service.explainAgentAvailability('u', agent.record.id, 'chat')).status).toBe(
        unavailableReason,
      )
      expect(await service.listInvocableAgents('u', 'chat')).toEqual([])
    },
  )
})
