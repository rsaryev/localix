import { afterEach, describe, expect, test } from 'bun:test'

import { __resetExpectedReports } from '../../delegation-awaits'
import type { AgentRequest } from './agent-tool'
import type { AgentLaunchPorts } from './agent-type'
import { launchAgent } from './agent-start'
import type { TaskDelegationOptions } from '../task-delegation'
import type { TaskAgentType, DelegateResolution } from '../task-delegation-contracts'

afterEach(() => __resetExpectedReports())

const REVIEWER: TaskAgentType = {
  fullName: 'sec:reviewer',
  name: 'reviewer',
  description: 'Reviews code for security issues',
  pinnedSkills: ['threat-model'],
  maxTurns: 7,
}
const TESTER: TaskAgentType = { fullName: 'tester', name: 'tester', description: 'Tests' }

/** The catalog as `resolveDelegation` answers: the agent with its own session, `self`, or nothing. */
const CATALOG: Record<string, DelegateResolution> = {
  'sec:reviewer': {
    kind: 'agent',
    agent: { agentId: 'cc:reviewer', name: 'sec:reviewer', maxTurns: 7 },
    type: REVIEWER,
  },
  tester: { kind: 'agent', agent: { agentId: 'cc:tester', name: 'tester' }, type: TESTER },
  'general-purpose': { kind: 'self' },
  claude: { kind: 'self' },
  reviewer: { kind: 'ambiguous', names: ['sec:reviewer', 'style:reviewer'] },
}

function host(ports: Partial<AgentLaunchPorts> = {}, catalog = CATALOG) {
  const calls: Record<string, unknown[]> = { create: [], start: [], subagent: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
    resolveAgent: (reference) =>
      reference === 'builtin:localix'
        ? { agentId: 'builtin:localix', name: 'localix', maxTurns: 40 }
        : null,
    resolveTarget: (reference) => catalog[reference] ?? { kind: 'unavailable' },
    createSession: async (_u, input) => {
      calls.create!.push(input)
      return { id: 'child', taskName: 'review' }
    },
    startSubagentTask: async (_u, sid, task, taskOpts) => {
      calls.start!.push({ sid, task, ...taskOpts })
      return undefined
    },
    onSubagentStart: async (agentType, id) => {
      calls.subagent!.push({ agentType, id })
      return undefined
    },
  }
  const all: AgentLaunchPorts = {
    ...ports,
  }
  return { opts, ports: all, calls }
}

const request = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  title: 'Review auth',
  task: 'Review the login handler',
  context: 'none',
  wait: false,
  ...over,
})

test('delegating to a catalog agent starts that agent, with its frontmatter', async () => {
  const { opts, ports, calls } = host()
  const result = await launchAgent(
    'call-1',
    request({ agent: 'sec:reviewer' }),
    opts,
    undefined,
    ports,
  )
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('agent sec:reviewer')
  expect(calls.create).toEqual([
    expect.objectContaining({
      agents: [{ agentId: 'cc:reviewer' }],
      provenance: expect.objectContaining({ agentType: 'sec:reviewer', depth: 1 }),
      pinnedSkills: ['threat-model'],
    }),
  ])
  // Claude Code's `agent_type` for SubagentStart/SubagentStop, and its own turn limit.
  expect(calls.subagent).toEqual([{ agentType: 'sec:reviewer', id: 'child' }])
  expect(calls.start![0]).toEqual(
    expect.objectContaining({
      agentType: 'sec:reviewer',
      maxTurns: 7,
      label: 'agent sec:reviewer',
    }),
  )
})

test('the model and effort the person chose for an agent are its child’s; without one it inherits', async () => {
  const chosen = host({
    choices: [
      { agentId: 'cc:reviewer', providerConnectionId: 'conn', modelId: 'gpt-6', effort: 'low' },
    ],
  })
  await launchAgent('c', request({ agent: 'sec:reviewer' }), chosen.opts, undefined, chosen.ports)
  expect(chosen.calls.create).toEqual([
    expect.objectContaining({
      providerConnectionId: 'conn',
      modelId: 'gpt-6',
      reasoningEffort: 'low',
    }),
  ])
  const plain = host({ choices: [{ agentId: 'cc:other', modelId: 'gpt-6' }] })
  await launchAgent('c', request({ agent: 'sec:reviewer' }), plain.opts, undefined, plain.ports)
  expect(plain.calls.create![0]).not.toHaveProperty('modelId')
})

test('an ambiguous or unknown agent is refused before anything is created', async () => {
  const { opts, ports, calls } = host()
  const ambiguous = await launchAgent('c', request({ agent: 'reviewer' }), opts, undefined, ports)
  expect(ambiguous.isError).toBe(true)
  expect(ambiguous.content).toContain('sec:reviewer, style:reviewer')
  const unknown = await launchAgent('c', request({ agent: 'sec:nobody' }), opts, undefined, ports)
  expect(unknown.isError).toBe(true)
  expect(unknown.content).toContain('agent directory')
  expect(calls.create).toEqual([])
})

test('background never holds the call; isolation works in a worktree kept for the child', async () => {
  const isolated: string[] = []
  const { opts, ports, calls } = host(
    {
      isolate: async (name) => {
        isolated.push(name)
        return { dir: '/wt/top', workingDir: '/wt/top/app', branch: 'localix/x' }
      },
    },
    {
      tester: {
        kind: 'agent',
        agent: { agentId: 'cc:tester', name: 'tester' },
        type: { ...TESTER, background: true, isolation: 'isolated' },
      },
    },
  )
  const result = await launchAgent(
    'call/9',
    request({ agent: 'tester', wait: true }),
    opts,
    undefined,
    ports,
  )
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('always runs in the background')
  expect(result.content).toContain('worktree /wt/top (branch localix/x)')
  expect(isolated).toEqual(['agent-call-9'])
  expect(calls.create).toEqual([
    expect.objectContaining({
      provenance: expect.objectContaining({ agentType: 'tester', workingDir: '/wt/top/app' }),
    }),
  ])
})

// sub-agents.md, "Built-in subagents": general-purpose (and the catch-all `claude`) is the
// delegator itself with every tool. A plugin command written for Claude Code names it
// (hookify: `"subagent_type": "general-purpose"`), so it must not be refused as unknown.
test('general-purpose and claude run the task as the delegator itself', async () => {
  for (const type of ['general-purpose', 'claude']) {
    const { opts, ports, calls } = host()
    const out = await launchAgent('c', request({ agent: type }), opts, undefined, ports)
    expect(JSON.stringify(out)).not.toContain('No enabled agent')
    expect(calls.create).toEqual([
      expect.objectContaining({
        agents: [{ agentId: 'builtin:localix' }],
        provenance: expect.objectContaining({ agentType: 'general-purpose' }),
      }),
    ])
    expect(calls.subagent).toEqual([{ agentType: 'general-purpose', id: 'child' }])
  }
})

// The person sets each agent's model and effort; neither the call nor a host can.
test('a host names a worktree for the child, never a model', async () => {
  const isolated: string[] = []
  const { opts, ports, calls } = host({
    isolate: async (name) => {
      isolated.push(name)
      return { dir: '/wt/c', workingDir: '/wt/c' }
    },
  })
  await launchAgent('c', request({ isolation: 'worktree' }), opts, undefined, ports)
  expect(isolated).toEqual(['agent-c'])
  expect(calls.create).toEqual([
    expect.objectContaining({ provenance: expect.objectContaining({ workingDir: '/wt/c' }) }),
  ])
})

// sub-agents.md, `tools`: "If no entry in the list resolves to a tool, the subagent usually fails
// to launch with an error naming the entries."
test('an agent whose tools list resolves to nothing is refused', async () => {
  const { opts, ports, calls } = host(
    {},
    {
      tester: {
        kind: 'agent',
        agent: { agentId: 'cc:tester', name: 'tester' },
        type: { ...TESTER, tools: [] },
      },
    },
  )
  const out = await launchAgent('c', request({ agent: 'tester' }), opts, undefined, ports)
  expect(out.isError).toBe(true)
  expect(out.content).toContain('zero tools')
  expect(calls.create).toEqual([])
})

// sub-agents.md, `permissionMode`: the person's own agent files carry it; a plugin's are ignored.
test.each([
  ['user', 'plan', 'plan'],
  ['project', 'default', 'default'],
  ['managed', 'plan', 'plan'],
  ['plugin', 'plan', undefined],
  ['user', 'acceptEdits', undefined],
  ['user', 'bypassPermissions', undefined],
  ['user', undefined, undefined],
] as const)(
  'a %s agent file with permissionMode %s leaves %s on the child',
  async (source, permissionMode, carried) => {
    const planner: DelegateResolution = {
      kind: 'agent',
      agent: { agentId: 'cc:planner', name: 'planner' },
      type: {
        fullName: 'planner',
        name: 'planner',
        description: 'Plans',
        source,
        ...(permissionMode ? { permissionMode } : {}),
      },
    }
    const { opts, ports, calls } = host({}, { planner })
    await launchAgent('c', request({ agent: 'planner' }), opts, undefined, ports)
    const provenance = (calls.create![0] as { provenance: Record<string, unknown> }).provenance
    expect(provenance.agentPermissionMode).toBe(carried)
  },
)

// sub-agents.md, `Agent(worker, researcher)` in `tools`: an allowlist of the types the agent may
// spawn; an omitted `agent` is `general-purpose`, which is then refused unless it is listed.
describe('an agent type allowlist on the delegator', () => {
  const allowing = (...types: string[]) => ({ allowedAgentTypes: types })

  test('only a listed type may be delegated to, and a refusal creates nothing', async () => {
    const { opts, ports, calls } = host(allowing('tester'))
    const ok = await launchAgent('c', request({ agent: 'tester' }), opts, undefined, ports)
    expect(ok.isError).toBeUndefined()
    for (const asked of [{ agent: 'sec:reviewer' }, {}, { agent: 'claude' }, { context: 'fork' }]) {
      const refused = await launchAgent(
        'c',
        request(asked as Partial<AgentRequest>),
        opts,
        undefined,
        ports,
      )
      expect(refused.isError).toBe(true)
      expect(refused.content).toContain('tester')
    }
    expect(calls.create).toHaveLength(1)
  })

  test('general-purpose is allowed when it is listed, and so is a plugin name by its name', async () => {
    const { opts, ports, calls } = host(allowing('general-purpose', 'sec:reviewer'))
    await launchAgent('c', request(), opts, undefined, ports)
    await launchAgent('c', request({ agent: 'sec:reviewer' }), opts, undefined, ports)
    expect(calls.create).toHaveLength(2)
  })

  test('with no list every type is allowed', async () => {
    const { opts, ports, calls } = host()
    await launchAgent('c', request({ agent: 'sec:reviewer' }), opts, undefined, ports)
    await launchAgent('c', request(), opts, undefined, ports)
    expect(calls.create).toHaveLength(2)
  })
})
