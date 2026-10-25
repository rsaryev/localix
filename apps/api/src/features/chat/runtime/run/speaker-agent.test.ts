import { expect, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { tempDirPerTest } from '@localixai/testing'

import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import {
  applySpeakerAgent,
  contextFilesFor,
  promptCacheRetentionFor,
  delegateAgentPorts,
} from './speaker-agent'

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

test("the delegate ports resolve a type's model alias against the chat's provider", async () => {
  const ports = delegateAgentPorts({
    chatModel: { providerId: 'anthropic', connectionId: 'conn', modelId: 'claude-sonnet-5' },
    catalog: [
      { id: 'claude-haiku-4-5', providerId: 'anthropic' },
      { id: 'gpt-4o-mini', providerId: 'openai' },
    ],
    defaultCwd: '/tmp',
    rootSessionId: 'root',
  })
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
  const ports = delegateAgentPorts({
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

const scratch = tempDirPerTest('speaker-agent-hook', {})

test("a type's isolated child works where the run's WorktreeCreate hook made its worktree", async () => {
  const dir = scratch()
  const named: string[] = []
  const ports = delegateAgentPorts({
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

// sub-agents.md, `experimental.cacheTtl`: `1h` is the longer-lived cache, `5m` the default.
test('a plugin agent with cacheTtl asks its runs for that cache lifetime', () => {
  expect(promptCacheRetentionFor({ ...REVIEWER, cacheTtl: '1h' })).toBe('long')
  expect(promptCacheRetentionFor({ ...REVIEWER, cacheTtl: '5m' })).toBe('short')
  expect(promptCacheRetentionFor(REVIEWER)).toBeUndefined()
  expect(promptCacheRetentionFor(null)).toBeUndefined()
})

// The agent a run is seated as brings its own ceiling, whoever seated it: a child delegated to it,
// a speaker tagged into a conversation, or a session started on it.
test('a run seated as a catalog agent takes its prompt, tool ceiling and instruction files', () => {
  const input = {
    agent: { id: 'cc:1', instructions: 'ignored' },
    disabledTools: ['ask'],
  }
  const applied = applySpeakerAgent(input, { ...REVIEWER, omitClaudeMd: true })
  expect(applied?.agent.instructions).toBe('You are the security reviewer.')
  expect(applied?.subagent.omitClaudeMd).toBe(true)
  expect(applied?.disabledTools).toEqual(
    expect.arrayContaining(['ask', 'research', 'bash', 'write']),
  )
  expect(applied?.disabledTools).not.toContain('read')
})

test('a file agent that lists only Read leaves every other Claude Code tool off', () => {
  const applied = applySpeakerAgent(
    { agent: { instructions: 'x' }, disabledTools: [] },
    { ...REVIEWER, tools: ['read'], disallowedTools: undefined },
  )
  expect(applied?.disabledTools).toEqual(
    expect.arrayContaining(['write', 'edit', 'bash', 'search']),
  )
  expect(applied?.disabledTools).not.toContain('read')
})

test('the default agent, and a seat with no definition behind it, keep their own run', () => {
  const input = { agent: { instructions: 'You are Localix.' }, disabledTools: [] }
  expect(applySpeakerAgent(input, undefined)).toBeNull()
})

test('the delegate ports carry the run agent’s Agent(...) allowlist', () => {
  const base = { catalog: [], defaultCwd: '/tmp', rootSessionId: 'root' }
  expect(delegateAgentPorts({ ...base, allowedAgentTypes: ['worker'] }).allowedAgentTypes).toEqual([
    'worker',
  ])
  expect(delegateAgentPorts(base).allowedAgentTypes).toBeUndefined()
})
