import { expect, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { tempDirPerTest } from '@localixai/testing'

import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import { parseSessionProvenance, serializeSessionProvenance } from '../../session-provenance'
import {
  AGENT_TYPES_HEADING,
  agentTypesSection,
  applyPluginSubagent,
  contextFilesFor,
  delegatePluginPorts,
} from './plugin-subagent'

const REVIEWER: LoadedPluginAgent = {
  pluginName: 'sec',
  name: 'reviewer',
  fullName: 'sec:reviewer',
  label: 'reviewer',
  description: 'Reviews code for security issues. Use after auth changes.',
  prompt: 'You are the security reviewer.',
  tools: ['read', 'search'],
  disallowedTools: ['research'],
}

const child = (pluginAgent?: string) =>
  parseSessionProvenance(
    serializeSessionProvenance({
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'call',
      depth: 1,
      ...(pluginAgent ? { pluginAgent } : {}),
    }),
  )

test('a child stored as a plugin agent type keeps it across a reload of its provenance', () => {
  expect(child('sec:reviewer')).toEqual(expect.objectContaining({ pluginAgent: 'sec:reviewer' }))
})

test("every run of the child takes the type's prompt and tool limits", () => {
  const input = {
    agent: { id: 'builtin:localix', instructions: 'You are Localix.' },
    disabledTools: ['ask'],
  }
  const applied = applyPluginSubagent(input, child('sec:reviewer'), [REVIEWER])
  expect(applied?.agent).toEqual({
    id: 'builtin:localix',
    instructions: 'You are the security reviewer.',
  })
  expect(applied?.subagent).toBe(REVIEWER)
  // Its own denial, and every Claude Code tool its `tools` list leaves out.
  expect(applied?.disabledTools).toEqual(
    expect.arrayContaining(['ask', 'research', 'bash', 'write', 'edit']),
  )
  expect(applied?.disabledTools).not.toContain('read')
  expect(applied?.disabledTools).not.toContain('search')
})

test('a child that is not a type, or whose plugin is gone, runs as its seated agent', () => {
  const input = { agent: { instructions: 'You are Localix.' }, disabledTools: [] }
  expect(applyPluginSubagent(input, child(), [REVIEWER])).toBeNull()
  expect(applyPluginSubagent(input, { kind: 'root' }, [REVIEWER])).toBeNull()
  const warned: string[] = []
  expect(
    applyPluginSubagent(input, child('gone:agent'), [REVIEWER], (m) => warned.push(m)),
  ).toBeNull()
  expect(warned).toEqual([expect.stringContaining('"gone:agent" is not enabled')])
})

test('# Agent types lists each type with when to use it and its tools', () => {
  const text = agentTypesSection([REVIEWER, { fullName: 'qa:tester', description: '' }])
  expect(text?.split('\n')[0]).toBe(AGENT_TYPES_HEADING)
  expect(text).toContain('agent: "<type>"')
  expect(text).toContain(
    '- sec:reviewer: Reviews code for security issues. Use after auth changes. (tools: read, search)',
  )
  expect(text).toContain('- qa:tester: No description.')
  expect(agentTypesSection([])).toBeNull()
})

test("the delegate ports resolve a type's model alias against the chat's provider", async () => {
  const ports = delegatePluginPorts({
    agents: [REVIEWER],
    chatModel: { providerId: 'anthropic', connectionId: 'conn', modelId: 'claude-sonnet-5' },
    catalog: [
      { id: 'claude-haiku-4-5', providerId: 'anthropic' },
      { id: 'gpt-4o-mini', providerId: 'openai' },
    ],
    defaultCwd: '/tmp',
    rootSessionId: 'root',
  })
  expect(ports.agents()).toEqual([REVIEWER])
  expect(await ports.route?.({ model: 'haiku', effort: 'low', who: 'agent sec:reviewer' })).toEqual(
    {
      route: { providerConnectionId: 'conn', modelId: 'claude-haiku-4-5', reasoningEffort: 'low' },
      notes: [],
    },
  )
  const missing = await ports.route?.({ model: 'gpt-4o-mini', who: 'agent sec:reviewer' })
  expect(missing?.route).toEqual({})
  expect(missing?.notes).toEqual([
    expect.stringContaining('agent sec:reviewer model "gpt-4o-mini"'),
  ])
})

test("a catalog that names its models with their provider still routes a type's model", async () => {
  const ports = delegatePluginPorts({
    agents: [REVIEWER],
    chatModel: { providerId: 'openai', connectionId: 'conn', modelId: 'gpt-4o' },
    catalog: [
      { id: 'openai/gpt-4o', providerId: 'openai' },
      { id: 'openai/gpt-4o-mini', providerId: 'openai' },
    ],
    defaultCwd: '/tmp',
    rootSessionId: 'root',
  })
  for (const model of ['gpt-4o-mini', 'openai/gpt-4o-mini'])
    expect((await ports.route?.({ model, who: 'agent sec:reviewer' }))?.route).toEqual({
      providerConnectionId: 'conn',
      modelId: 'gpt-4o-mini',
    })
})

const scratch = tempDirPerTest('plugin-subagent-hook', {})

test("a type's isolated child works where the run's WorktreeCreate hook made its worktree", async () => {
  const dir = scratch()
  const named: string[] = []
  const ports = delegatePluginPorts({
    agents: [],
    catalog: [],
    defaultCwd: dir,
    rootSessionId: 'root',
    worktreeHook: async (name) => {
      named.push(name)
      return { ok: true, path: dir, cwd: dir }
    },
  })
  const worktree = await ports.isolate!('delegate-call-1')
  expect(named).toEqual(['delegate-call-1'])
  expect(worktree).toMatchObject({ byHook: true })
  expect(await realpath(worktree.workingDir)).toBe(await realpath(dir))
})

// skills.md: "Claude Code starts a new subagent of the type set in the `agent` field"; "The `agent`
// field determines the execution environment (model, tools, and permissions)".
test('a context: fork skill whose agent names a plugin agent runs as that agent', () => {
  const fork = (pluginAgent?: string) =>
    parseSessionProvenance(
      serializeSessionProvenance({
        kind: 'skill-fork',
        parentSessionId: 'parent',
        ...(pluginAgent ? { pluginAgent } : {}),
      }),
    )
  const input = { agent: { instructions: 'You are Localix.' }, disabledTools: [] }
  expect(fork('sec:reviewer')).toEqual(expect.objectContaining({ pluginAgent: 'sec:reviewer' }))
  expect(applyPluginSubagent(input, fork('sec:reviewer'), [REVIEWER])?.agent.instructions).toBe(
    'You are the security reviewer.',
  )
  // By a bare name only one enabled agent has.
  expect(applyPluginSubagent(input, fork('reviewer'), [REVIEWER])?.subagent).toBe(REVIEWER)
  const other = { ...REVIEWER, pluginName: 'ops', fullName: 'ops:reviewer' }
  expect(applyPluginSubagent(input, fork('reviewer'), [REVIEWER, other])).toBeNull()
  expect(applyPluginSubagent(input, fork(), [REVIEWER])).toBeNull()
})

// plugins/components, "Frontmatter fields in plugin agents": `omitClaudeMd` runs the agent without
// the project's CLAUDE.md files (here also AGENTS.md, which Localix reads in their place).
test('a plugin agent with omitClaudeMd runs without the workspace instruction files', () => {
  const files = [
    { path: '/repo/AGENTS.md', content: 'repo rules' },
    { path: '/repo/sub/CLAUDE.md', content: 'sub rules' },
    { path: '/repo/.localix/context.md', content: 'context' },
  ]
  expect(contextFilesFor(files, { ...REVIEWER, omitClaudeMd: true })).toEqual([files[2]])
  expect(contextFilesFor(files, REVIEWER)).toEqual(files)
  expect(contextFilesFor(files, null)).toEqual(files)
})
