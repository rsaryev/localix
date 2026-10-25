import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { AgentDirectoryRow } from '../features/agents/delegation'
import { createAgentDirectoryPorts } from './agent-directory-ports'

const scratch = tempDirPerTest('agent-directory-ports-')

const row = (name: string, over: Partial<AgentDirectoryRow> = {}): AgentDirectoryRow => ({
  agentId: `cc:${name}`,
  name,
  description: '',
  leadershipPriority: 0,
  enabled: true,
  canJoinConversation: true,
  delegable: true,
  ...over,
})

function ports(settings: Record<string, unknown>) {
  const root = scratch()
  writeTree(root, { 'home/.claude/settings.json': JSON.stringify(settings) })
  return createAgentDirectoryPorts(
    {
      directory: async () => [row('reviewer'), row('sec:auditor'), row('writer')],
    } as never,
    { homeDir: join(root, 'home'), cwdOf: async () => null },
  )
}

// permissions.md, "Agent": `Agent(name)` in deny stops Claude using that subagent. The directory is
// what the model reads to choose one, so a denied agent must not be offered for delegation.
test('an Agent(name) deny keeps the agent out of what delegate is offered', async () => {
  const rows = await ports({
    permissions: { deny: ['Agent(reviewer)', 'Agent(auditor)'] },
  }).listRegistryAgents('u', null)
  expect(rows.map((r) => [r.name, r.delegable])).toEqual([
    ['reviewer', false],
    ['sec:auditor', false],
    ['writer', true],
  ])
})

test('an ask or an allow rule, and no settings at all, hide nobody', async () => {
  const rows = await ports({
    permissions: { ask: ['Agent(reviewer)'], allow: ['Agent(writer)'] },
  }).listRegistryAgents('u', null)
  expect(rows.every((r) => r.delegable)).toBe(true)
})
