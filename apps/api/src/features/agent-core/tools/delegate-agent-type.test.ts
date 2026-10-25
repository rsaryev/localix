import { afterEach, expect, test } from 'bun:test'

import { __resetExpectedReports } from '../delegation-awaits'
import type { DelegateRequest } from './delegate'
import type { DelegateAgentPorts } from './delegate-agent-type'
import { startDelegation } from './delegate-start'
import type { TaskDelegationOptions } from './task-delegation'
import type { DelegateAgentType, DelegateResolution } from './task-delegation-contracts'

afterEach(() => __resetExpectedReports())

const REVIEWER: DelegateAgentType = {
  fullName: 'sec:reviewer',
  name: 'reviewer',
  description: 'Reviews code for security issues',
  preferredModel: 'haiku',
  preferredEffort: 'high',
  pinnedSkills: ['threat-model'],
  maxTurns: 7,
}
const TESTER: DelegateAgentType = { fullName: 'tester', name: 'tester', description: 'Tests' }

/** The catalog as `resolveDelegation` answers: the agent with its own seat, `self`, or nothing. */
const CATALOG: Record<string, DelegateResolution> = {
  'sec:reviewer': {
    kind: 'agent',
    agent: { agentId: 'cc:reviewer', handle: 'sec:reviewer', maxTurns: 7 },
    type: REVIEWER,
  },
  tester: { kind: 'agent', agent: { agentId: 'cc:tester', handle: 'tester' }, type: TESTER },
  'general-purpose': { kind: 'self' },
  claude: { kind: 'self' },
  reviewer: { kind: 'ambiguous', names: ['sec:reviewer', 'style:reviewer'] },
}

function host(ports: Partial<DelegateAgentPorts> = {}, catalog = CATALOG) {
  const calls: Record<string, unknown[]> = { create: [], start: [], route: [], subagent: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
    resolveAgent: (reference) =>
      reference === 'builtin:localix'
        ? { agentId: 'builtin:localix', handle: 'localix', maxTurns: 40 }
        : null,
    resolveTarget: (reference) => catalog[reference] ?? { kind: 'unavailable' },
    createSession: async (_u, input) => {
      calls.create!.push(input)
      return { id: 'child', taskName: 'review' }
    },
    copyConversation: async () => {},
    startSubagentTask: async (_u, sid, task, taskOpts) => {
      calls.start!.push({ sid, task, ...taskOpts })
      return undefined
    },
    onSubagentStart: async (agentType, id) => {
      calls.subagent!.push({ agentType, id })
      return undefined
    },
  }
  const all: DelegateAgentPorts = {
    route: (asked) => {
      calls.route!.push(asked)
      return {
        route: {
          providerConnectionId: 'conn',
          modelId: asked.model && !/^haiku$/.test(asked.model) ? asked.model : 'claude-haiku-5',
          reasoningEffort: 'high',
        },
        notes: [],
      }
    },
    ...ports,
  }
  return { opts, ports: all, calls }
}

const request = (over: Partial<DelegateRequest> = {}): DelegateRequest => ({
  title: 'Review auth',
  task: 'Review the login handler',
  context: 'none',
  wait: false,
  ...over,
})

test('delegating to a catalog agent seats that agent, with its frontmatter', async () => {
  const { opts, ports, calls } = host()
  const result = await startDelegation(
    'call-1',
    request({ agent: 'sec:reviewer' }),
    opts,
    undefined,
    ports,
  )
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('agent sec:reviewer')
  expect(calls.route).toEqual([{ model: 'haiku', effort: 'high', who: 'agent sec:reviewer' }])
  expect(calls.create).toEqual([
    expect.objectContaining({
      agents: [{ agentId: 'cc:reviewer' }],
      provenance: expect.objectContaining({ agentType: 'sec:reviewer', depth: 1 }),
      providerConnectionId: 'conn',
      modelId: 'claude-haiku-5',
      reasoningEffort: 'high',
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

test('the agent’s own localix route stands in for its model, and gives way to the call’s', async () => {
  const routed: DelegateResolution = {
    kind: 'agent',
    agent: { agentId: 'cc:r', handle: 'router' },
    type: {
      fullName: 'router',
      name: 'router',
      description: '',
      localix: { model: 'openai/gpt-6' },
    },
  }
  const { opts, ports, calls } = host({}, { router: routed })
  await startDelegation('c', request({ agent: 'router' }), opts, undefined, ports)
  expect(calls.route).toEqual([{ route: 'openai/gpt-6', who: 'agent router' }])
  await startDelegation('c', request({ agent: 'router', model: 'gpt-4o' }), opts, undefined, ports)
  expect(calls.route![1]).toEqual({ model: 'gpt-4o', who: 'agent router' })
})

test('an ambiguous or unknown agent is refused before anything is created', async () => {
  const { opts, ports, calls } = host()
  const ambiguous = await startDelegation(
    'c',
    request({ agent: 'reviewer' }),
    opts,
    undefined,
    ports,
  )
  expect(ambiguous.isError).toBe(true)
  expect(ambiguous.content).toContain('sec:reviewer, style:reviewer')
  const unknown = await startDelegation(
    'c',
    request({ agent: 'sec:nobody' }),
    opts,
    undefined,
    ports,
  )
  expect(unknown.isError).toBe(true)
  expect(unknown.content).toContain('agent directory')
  expect(calls.create).toEqual([])
})

test("a host's model wins over the agent's; its effort still applies", async () => {
  const { opts, ports, calls } = host()
  await startDelegation(
    'c',
    request({ agent: 'sec:reviewer', model: 'gpt-4o' }),
    opts,
    undefined,
    ports,
  )
  expect(calls.route).toEqual([{ model: 'gpt-4o', effort: 'high', who: 'agent sec:reviewer' }])
  expect(calls.create).toEqual([expect.objectContaining({ modelId: 'gpt-4o' })])
})

test('a model the chat’s provider does not offer is still used as written', async () => {
  const { opts, calls } = host()
  await startDelegation('c', request({ agent: 'sec:reviewer', model: 'gpt-4o' }), opts, undefined, {
    route: () => ({ route: {}, notes: ['not offered'] }),
  })
  expect(calls.create).toEqual([expect.objectContaining({ modelId: 'gpt-4o' })])
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
        agent: { agentId: 'cc:tester', handle: 'tester' },
        type: { ...TESTER, background: true, isolation: 'isolated' },
      },
    },
  )
  const result = await startDelegation(
    'call/9',
    request({ agent: 'tester', wait: true }),
    opts,
    undefined,
    ports,
  )
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('always runs in the background')
  expect(result.content).toContain('worktree /wt/top (branch localix/x)')
  expect(isolated).toEqual(['delegate-call-9'])
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
    const out = await startDelegation('c', request({ agent: type }), opts, undefined, ports)
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

// claude-code-tools Agent input: `model`, `effort` and `isolation` are the caller's per call, and
// a call's model and effort win over the agent file's (sub-agents.md, "Choose a model").
test('a call names the child model, effort and a worktree of its own', async () => {
  const isolated: string[] = []
  const { opts, ports, calls } = host({
    isolate: async (name) => {
      isolated.push(name)
      return { dir: '/wt/c', workingDir: '/wt/c' }
    },
  })
  await startDelegation(
    'c',
    request({ model: 'haiku', effort: 'low', isolation: 'worktree' }),
    opts,
    undefined,
    ports,
  )
  expect(calls.route).toEqual([{ model: 'haiku', effort: 'low', who: 'agent localix' }])
  expect(isolated).toEqual(['delegate-c'])
  expect(calls.create).toEqual([
    expect.objectContaining({
      modelId: 'claude-haiku-5',
      reasoningEffort: 'high',
      provenance: expect.objectContaining({ workingDir: '/wt/c' }),
    }),
  ])

  const typed = host()
  await startDelegation(
    'c',
    request({ agent: 'sec:reviewer', effort: 'max' }),
    typed.opts,
    undefined,
    typed.ports,
  )
  expect(typed.calls.route).toEqual([expect.objectContaining({ effort: 'max' })])
})

// sub-agents.md, `tools`: "If no entry in the list resolves to a tool, the subagent usually fails
// to launch with an error naming the entries."
test('an agent whose tools list resolves to nothing is refused', async () => {
  const { opts, ports, calls } = host(
    {},
    {
      tester: {
        kind: 'agent',
        agent: { agentId: 'cc:tester', handle: 'tester' },
        type: { ...TESTER, tools: [] },
      },
    },
  )
  const out = await startDelegation('c', request({ agent: 'tester' }), opts, undefined, ports)
  expect(out.isError).toBe(true)
  expect(out.content).toContain('zero tools')
  expect(calls.create).toEqual([])
})
