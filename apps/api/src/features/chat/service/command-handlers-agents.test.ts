import { describe, expect, test } from 'bun:test'
import { sessionFixture } from '../../../testing/session-fixture'
import { handleAgentsControlCommand } from './command-handlers-agents'
import type { CommandHandlerContext } from './command-handlers-context'
import type { AgentSummary } from '../../agents/contracts'
import type { MessageMutationResponse } from '../contracts'
import { localixUiUri } from '@localixai/mini-app-sdk/navigation'

const agent: AgentSummary = {
  record: {
    id: 'native:qa',
    handle: 'qa',
    description: 'Reviews',
    instructions: 'Review.',
    leadershipPriority: 0,
  },
  enabled: true,
  projectId: 'p',
  scope: 'project',
  invocations: { chat: 'allow' },
  source: 'user',
  path: '',
  editable: true,
}
const session = sessionFixture({
  projectId: 'p',
  agents: [
    {
      agentId: 'builtin:localix',
      handle: 'localix',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'high',
    },
  ],
})

function harness(currentSession = session) {
  const replies: string[] = []
  const writes: unknown[] = []
  const membership: unknown[] = []
  const macros: { prompt: string; instruction: string; opts: unknown }[] = []
  let uses: unknown[] = []
  let announced = 0
  const query = {
    innerJoin: () => query,
    select: () => query,
    where: () => query,
    execute: async () => uses,
  }
  const service = {
    listAgents: async () => [agent],
    getAgent: async (_u: string, ref: string) => (ref === 'missing' ? null : agent),
    createAgent: async (...args: unknown[]) => {
      writes.push(['create', ...args])
      return agent
    },
    updateAgent: async (...args: unknown[]) => {
      writes.push(['edit', ...args])
      return agent
    },
    duplicateAgent: async (...args: unknown[]) => {
      writes.push(['copy', ...args])
      return { ...agent, record: { ...agent.record, handle: 'qa-copy' } }
    },
    setAgentEnabled: async (...args: unknown[]) => {
      writes.push(['enable', ...args])
      return agent
    },
    deleteAgent: async (...args: unknown[]) => {
      writes.push(['delete', ...args])
    },
  }
  const ctx = {
    deps: {
      agentManagement: service,
      db: { selectFrom: () => query },
      announceCapabilityChange: () => announced++,
    },
    changeAgentMembership: async (...args: unknown[]) => {
      membership.push(args)
      return { invited: [agent], removed: [], session }
    },
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false },
    now: () => '2026-10-13T09:00:00.000Z',
    runMacroCommand: async (...args: unknown[]) => {
      macros.push({
        prompt: args[4] as string,
        instruction: args[5] as string,
        opts: args[7],
      })
      return {} as MessageMutationResponse
    },
  } as unknown as CommandHandlerContext
  const run = (prompt: string) =>
    handleAgentsControlCommand(ctx, currentSession.userId, currentSession, prompt, async (text) => {
      replies.push(text)
      return {} as MessageMutationResponse
    })
  return {
    run,
    replies,
    writes,
    membership,
    macros,
    setUses: (next: unknown[]) => {
      uses = next
    },
    announced: () => announced,
  }
}

describe('/agents management', () => {
  test('unavailable definitions remain visible and removable by their seated identity', async () => {
    const h = harness({
      ...session,
      agents: [{ ...session.agents[0]!, agentId: 'gone', handle: 'missing' }],
    })
    await h.run('/agents members')
    expect(h.replies[0]).toContain('@missing · definition unavailable')
    await h.run('/agents remove @missing')
    expect(h.membership).toEqual([[session.userId, session.id, { remove: ['gone'] }]])
  })
  test('list, inspection and profile destinations read only and preserve the project', async () => {
    const h = harness()
    await h.run('/agents list')
    await h.run('/agents show @qa')
    await h.run('/agents permissions @qa')
    await h.run('/agents create migration-reviewer')
    expect(h.replies[0]).toContain('@qa')
    expect(h.replies[1]).toContain('Review.')
    expect(h.replies[2]).toContain(
      localixUiUri('work-item', ['store'], { kind: 'agent', id: 'native:qa' }),
    )
    // A new agent is made on the Agents shelf of the Store, where the Create button is.
    expect(h.replies[3]).toContain(localixUiUri('work-item', ['store', 'agents']))
    expect(h.writes).toEqual([])
  })
  test('explicit creation and edits are deterministic and cannot write permissions', async () => {
    const h = harness()
    await h.run('/agents create qa --description "Reviews" --instructions "Review." --priority 0')
    expect(h.writes[0]).toEqual([
      'create',
      session.userId,
      {
        handle: 'qa',
        description: 'Reviews',
        instructions: 'Review.',
        leadershipPriority: 0,
        projectId: 'p',
      },
    ])
    await h.run('/agents edit @qa --description "New description"')
    expect(h.writes[1]).toEqual([
      'edit',
      session.userId,
      'native:qa',
      {
        handle: 'qa',
        description: 'New description',
        instructions: 'Review.',
        leadershipPriority: 0,
        projectId: 'p',
      },
      'p',
    ])
    await h.run('/agents edit @qa --permissions allow')
    expect(h.writes).toHaveLength(2)
    expect(h.announced()).toBe(2)
  })

  test('priority is required for direct creation and editing it preserves identity and policy', async () => {
    const h = harness()
    await h.run('/agents create qa --description "Reviews" --instructions "Review."')
    expect(h.writes).toEqual([])
    await h.run('/agents edit @qa --priority -1')
    expect(h.writes).toEqual([
      [
        'edit',
        session.userId,
        agent.record.id,
        expect.objectContaining({ leadershipPriority: -1, handle: 'qa', instructions: 'Review.' }),
        'p',
      ],
    ])
  })
  test('add and remove go through the shared membership port without creating runs', async () => {
    const h = harness()
    await h.run('/agents add @qa')
    await h.run('/agents remove @qa')
    expect(h.membership).toEqual([
      [session.userId, session.id, { invite: ['native:qa'] }],
      [session.userId, session.id, { remove: ['native:qa'] }],
    ])
    expect(h.writes).toEqual([])
    expect(h.replies[0]).toContain('to start work')
  })
  test('deletion requires a preview and an unused exact identity', async () => {
    const h = harness()
    await h.run('/agents delete @qa')
    expect(h.writes).toEqual([])
    expect(h.replies[0]).toContain('/agents delete native:qa --confirm')
    h.setUses([{ id: 'other-chat', title: 'Other chat' }])
    await h.run('/agents delete native:qa --confirm')
    expect(h.writes).toEqual([])
    h.setUses([])
    await h.run('/agents delete native:qa --confirm')
    expect(h.writes).toEqual([['delete', session.userId, 'native:qa', 'p']])
  })
  test('extra arguments and unrelated fields cannot silently change state', async () => {
    const h = harness()
    for (const prompt of [
      '/agents enable @qa other',
      '/agents list --confirm',
      '/agents add @qa --instructions hi',
      '/agents delegate @qa',
      '/agents create qa --description hi',
    ])
      await h.run(prompt)
    expect(h.writes).toEqual([])
    expect(h.membership).toEqual([])
    expect(h.replies.every((reply) => reply.startsWith('Agent command failed:'))).toBe(true)
  })
  test('create in your own words starts an agent turn that must use the agents tool', async () => {
    const h = harness()
    await h.run("/agents create a reviewer that doesn't skip\n- migrations\n- retries")
    expect(h.writes).toEqual([])
    expect(h.replies).toEqual([])
    expect(h.macros).toHaveLength(1)
    expect(h.macros[0]!.instruction).toContain(
      "registry: a reviewer that doesn't skip\n- migrations\n- retries",
    )
    expect(h.macros[0]!.opts).toEqual({
      commandOrigin: { command: '/agents create', label: 'Agent · new' },
      requiredTools: [{ name: 'agents' }],
    })
  })

  test('a single handle, options or no argument keep the deterministic create paths', async () => {
    const h = harness()
    for (const prompt of [
      '/agents create',
      '/agents create qa',
      '/agents create @qa',
      '/agents create qa --description Reviews SQL --instructions Check --priority 0',
    ])
      await h.run(prompt)
    expect(h.macros).toEqual([])
    expect(h.writes).toHaveLength(1)
    await h.run('/agents create \u0420\u0435\u0432\u044c\u044e\u0435\u0440')
    expect(h.macros).toHaveLength(1)
  })
})
