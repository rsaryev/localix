import { expect, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { tempDirPerTest } from '@localixai/testing'

import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import {
  applyCatalogAgent,
  contextFilesFor,
  promptCacheRetentionFor,
  agentLaunchPorts,
} from './catalog-agent'

const REVIEWER: LoadedPluginAgent = {
  pluginName: 'sec',
  name: 'reviewer',
  fullName: 'sec:reviewer',
  label: 'reviewer',
  description: 'Reviews code for security issues. Use after auth changes.',
  prompt: 'You are the security reviewer.',
  tools: ['Read', 'Search'],
  disallowedTools: ['Research'],
}

const scratch = tempDirPerTest('catalog-agent-hook', {})

test("a type's isolated child works where the run's WorktreeCreate hook made its worktree", async () => {
  const dir = scratch()
  const named: string[] = []
  const ports = agentLaunchPorts({
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

// The agent a run runs as brings its own ceiling, whoever started it: a child delegated to it,
// an agent chosen for a chat, or a session started on it.
test('a run as a catalog agent takes its prompt, tool ceiling and instruction files', () => {
  const input = {
    agent: { id: 'cc:1', instructions: 'ignored' },
    disabledTools: ['AskUserQuestion'],
  }
  const applied = applyCatalogAgent(input, { ...REVIEWER, omitClaudeMd: true })
  expect(applied?.agent.instructions).toBe('You are the security reviewer.')
  expect(applied?.subagent.omitClaudeMd).toBe(true)
  expect(applied?.disabledTools).toEqual(
    expect.arrayContaining(['AskUserQuestion', 'Research', 'Bash', 'Write']),
  )
  expect(applied?.disabledTools).not.toContain('Read')
})

test('a file agent that lists only Read leaves every other Claude Code tool off', () => {
  const applied = applyCatalogAgent(
    { agent: { instructions: 'x' }, disabledTools: [] },
    { ...REVIEWER, tools: ['Read'], disallowedTools: undefined },
  )
  expect(applied?.disabledTools).toEqual(
    expect.arrayContaining(['Write', 'Edit', 'Bash', 'Search']),
  )
  expect(applied?.disabledTools).not.toContain('Read')
})

test('the default agent, and a route with no definition behind it, keep their own run', () => {
  const input = { agent: { instructions: 'You are Localix.' }, disabledTools: [] }
  expect(applyCatalogAgent(input, undefined)).toBeNull()
})

test('the delegate ports carry the run agent’s Agent(...) allowlist', () => {
  const base = { catalog: [], defaultCwd: '/tmp', rootSessionId: 'root' }
  expect(agentLaunchPorts({ ...base, allowedAgentTypes: ['worker'] }).allowedAgentTypes).toEqual([
    'worker',
  ])
  expect(agentLaunchPorts(base).allowedAgentTypes).toBeUndefined()
})
