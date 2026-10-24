import { afterEach, expect, test } from 'bun:test'

import { __resetExpectedReports } from '../delegation-awaits'
import type { DelegateRequest } from './delegate'
import {
  matchPluginAgent,
  type DelegatePluginPorts,
  type PluginAgentType,
} from './delegate-plugin-agent'
import { startDelegation } from './delegate-start'
import type { TaskDelegationOptions } from './task-delegation'

afterEach(() => __resetExpectedReports())

const REVIEWER: PluginAgentType = {
  fullName: 'sec:reviewer',
  name: 'reviewer',
  description: 'Reviews code for security issues',
  preferredModel: 'haiku',
  preferredEffort: 'high',
  pinnedSkills: ['threat-model'],
  maxTurns: 7,
}
const OTHER_REVIEWER: PluginAgentType = {
  fullName: 'style:reviewer',
  name: 'reviewer',
  description: '',
}
const TESTER: PluginAgentType = { fullName: 'qa-kit:tester', name: 'tester', description: 'Tests' }

function host(plugins: Partial<DelegatePluginPorts> = {}) {
  const calls: Record<string, unknown[]> = { create: [], start: [], route: [], subagent: [] }
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'parent',
    position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
    resolveAgent: (reference) =>
      ({
        'builtin:localix': { agentId: 'builtin:localix', handle: 'localix', maxTurns: 40 },
        tester: { agentId: 'native:tester', handle: 'tester' },
      })[reference] ?? null,
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
  const ports: DelegatePluginPorts = {
    agents: () => [REVIEWER, TESTER],
    route: (asked) => {
      calls.route!.push(asked)
      return {
        route: { providerConnectionId: 'conn', modelId: 'claude-haiku-5', reasoningEffort: 'high' },
        notes: [],
      }
    },
    ...plugins,
  }
  return { opts, ports, calls }
}

const request = (over: Partial<DelegateRequest> = {}): DelegateRequest => ({
  title: 'Review auth',
  task: 'Review the login handler',
  context: 'none',
  wait: false,
  ...over,
})

test('a plugin agent is named by its full name, or by a bare name one plugin alone defines', () => {
  const agents = [REVIEWER, OTHER_REVIEWER, TESTER]
  expect(matchPluginAgent('sec:reviewer', agents)).toEqual({ agent: REVIEWER })
  expect(matchPluginAgent('@QA-KIT:Tester', agents)).toEqual({ agent: TESTER })
  expect(matchPluginAgent('tester', agents)).toEqual({ agent: TESTER })
  expect(matchPluginAgent('reviewer', agents)).toEqual({
    ambiguous: ['sec:reviewer', 'style:reviewer'],
  })
  expect(matchPluginAgent('sec:nobody', agents)).toBeNull()
})

test('delegating to a plugin agent seats the delegator as that type, with its frontmatter', async () => {
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
      agents: [{ agentId: 'builtin:localix' }],
      provenance: expect.objectContaining({ pluginAgent: 'sec:reviewer', depth: 1 }),
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

test('a registry agent keeps its name; a bare name falls through to a plugin type', async () => {
  const registry = host()
  await startDelegation('c', request({ agent: 'tester' }), registry.opts, undefined, registry.ports)
  expect(registry.calls.create).toEqual([
    expect.objectContaining({ agents: [{ agentId: 'native:tester' }] }),
  ])
  expect((registry.calls.create![0] as { provenance: object }).provenance).not.toHaveProperty(
    'pluginAgent',
  )

  const bare = host()
  await startDelegation('c', request({ agent: 'reviewer' }), bare.opts, undefined, bare.ports)
  expect(bare.calls.create).toEqual([
    expect.objectContaining({
      provenance: expect.objectContaining({ pluginAgent: 'sec:reviewer' }),
    }),
  ])
})

test('an ambiguous or unknown type is refused before anything is created', async () => {
  const { opts, ports, calls } = host({ agents: () => [REVIEWER, OTHER_REVIEWER] })
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
  expect(unknown.content).toContain('agent types')
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
  expect(calls.route).toEqual([{ effort: 'high', who: 'agent sec:reviewer' }])
  expect(calls.create).toEqual([expect.objectContaining({ modelId: 'gpt-4o' })])
})

test('background never holds the call; isolation works in a worktree kept for the child', async () => {
  const isolated: string[] = []
  const { opts, ports, calls } = host({
    agents: () => [{ ...TESTER, background: true, isolation: 'isolated' }],
    isolate: async (name) => {
      isolated.push(name)
      return { dir: '/wt/top', workingDir: '/wt/top/app', branch: 'localix/x' }
    },
  })
  const result = await startDelegation(
    'call/9',
    request({ agent: 'qa-kit:tester', wait: true }),
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
      provenance: expect.objectContaining({
        pluginAgent: 'qa-kit:tester',
        workingDir: '/wt/top/app',
      }),
    }),
  ])
})

test('without plugin ports a type is an unknown agent', async () => {
  const { opts, calls } = host()
  const result = await startDelegation('c', request({ agent: 'sec:reviewer' }), opts)
  expect(result.isError).toBe(true)
  expect(calls.create).toEqual([])
})

// sub-agents.md, "Built-in subagents": general-purpose (and the catch-all `claude`) is the
// delegator itself with every tool. A plugin command written for Claude Code names it
// (hookify: `"subagent_type": "general-purpose"`), so it must not be refused as unknown.
test('general-purpose and claude run the task as the delegator itself', async () => {
  for (const type of ['general-purpose', 'claude', 'General-Purpose']) {
    const { opts, ports, calls } = host()
    const out = await startDelegation('c', request({ agent: type }), opts, undefined, ports)
    expect(JSON.stringify(out)).not.toContain('No enabled agent')
    expect(calls.create).toEqual([
      expect.objectContaining({ agents: [{ agentId: 'builtin:localix' }] }),
    ])
    expect((calls.create![0] as { provenance: object }).provenance).not.toHaveProperty(
      'pluginAgent',
    )
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
test('an agent type whose tools list resolves to nothing is refused', async () => {
  const { opts, ports, calls } = host({ agents: () => [{ ...TESTER, tools: [] }] })
  const out = await startDelegation(
    'c',
    request({ agent: 'qa-kit:tester' }),
    opts,
    undefined,
    ports,
  )
  expect(out.isError).toBe(true)
  expect(out.content).toContain('zero tools')
  expect(calls.create).toEqual([])
})
