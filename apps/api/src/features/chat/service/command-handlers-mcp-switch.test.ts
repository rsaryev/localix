import { afterEach, beforeEach, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import { createAvailabilityWriter, readAvailability } from '../../capabilities/availability'
import type { McpServerRecord } from '../../mcp/repository'
import { handleMcpControlCommand } from './command-handlers-mcp'

/**
 * `/mcp enable|disable` flips the switch of the agent the session's runs read it from, so the
 * reply ("Enabled", "Disabled") is what the next turn then sees.
 */
let db: ReturnType<typeof createDatabase>
beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
})
afterEach(async () => {
  await destroyDatabase(db)
})

const echo: McpServerRecord = {
  id: 'plugin:kit:echo',
  userId: 'user-1',
  projectId: '',
  name: 'kit_echo',
  description: '',
  transport: 'stdio',
  config: { command: ['echo'] },
  createdAt: '',
  updatedAt: '',
}

async function command(prompt: string, agentName: string) {
  const session = sessionFixture({
    userId: 'user-1',
    agent: routedAgent({ name: agentName }),
  })
  const replies: string[] = []
  await handleMcpControlCommand(
    {
      mcpRepo: { listForScope: async () => [] },
      loadSessionPluginMcpServers: async () => [echo],
      resolveSessionWorkingDir: async () => '/tmp',
      availabilityWriter: createAvailabilityWriter(db),
      deps: { db },
    } as never,
    'user-1',
    session,
    prompt,
    (async (text: string) => void replies.push(text)) as never,
  )
  const agentId = session.agent!.agentId
  const effect = (await readAvailability(db, { userId: 'user-1', agentId })).effectFor(
    'mcp',
    'kit_echo',
  )
  return { replies, effect }
}

test('disabling a server denies it for the agent the session runs as', async () => {
  const { replies, effect } = await command('/mcp disable kit_echo', 'qa')
  expect(replies[0]).toContain('Disabled')
  expect(effect).toBe('deny')
})

test('enabling it again allows it for that agent, and the reply is true', async () => {
  await command('/mcp disable kit_echo', 'qa')
  const { replies, effect } = await command('/mcp enable kit_echo', 'qa')
  expect(replies[0]).toContain('Enabled')
  expect(effect).toBe('allow')
})
