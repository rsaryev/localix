import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed } from '../changes/core-entities'
import { createMcpRepository } from '../mcp/repository'
import { createCapabilityCleanup } from './cleanup'
import { createCapabilityRuleRepository } from './rule-repository'
import { createCapabilitySourceRepository } from './source-repository'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const signOuts: string[] = []
  const unbound: string[] = []
  const cleanup = createCapabilityCleanup({
    db,
    userId: 'u1',
    clearMcpSignIn: async (_u, id) => void signOuts.push(id),
    unbindVaultConsumer: async (_u, type, id) => (unbound.push(`${type}:${id}`), 1),
  })
  const rules = createCapabilityRuleRepository(db)
  await rules.replace('u1', 'a1', [
    { action: 'plugin:kanban', resource: '*', effect: 'allow' },
    { action: 'mcp:github', resource: '*', effect: 'allow' },
    { action: 'mcp:github/create_issue', resource: '*', effect: 'deny' },
    { action: 'mcp:github', resource: 'repo:x', effect: 'ask' },
    { action: 'mcp:gitlab', resource: '*', effect: 'allow' },
  ])
  return { db, cleanup, rules, signOuts, unbound }
}

describe('capability cleanup', () => {
  test('a removed MCP server takes its switches and its sign-in; a duplicate is harmless', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('capability-cleanup', t.cleanup.handlers, { kind: 'reactor' })
    const mcp = createMcpRepository(t.db)
    await t.db
      .insertInto('capability_source')
      .values({
        id: 'srv1',
        user_id: 'u1',
        kind: 'mcp',
        name: 'github',
        created_at: 'x',
        updated_at: 'x',
      })
      .execute()
    const server = { id: 'srv1' }
    await mcp.delete('u1', server.id)
    await feed.settle()
    await t.cleanup.removed('mcp', 'github', server.id)
    expect((await t.rules.read('u1', 'a1')).map((r) => `${r.action} ${r.resource}`)).toEqual([
      'plugin:kanban *',
      // The person's own rule about particular arguments stays.
      'mcp:github repo:x',
      'mcp:gitlab *',
    ])
    expect(t.signOuts).toEqual([server.id, server.id])
    await feed.close()
  })

  test('a plugin removed from one scope but installed in another keeps everything', async () => {
    const t = await setup()
    const plugins = createCapabilitySourceRepository(t.db, 'plugin')
    await plugins.upsert('u1', '', 'kanban', { source: 'local' })
    await plugins.upsert('u1', 'p1', 'kanban', { source: 'local' })
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('capability-cleanup', t.cleanup.handlers, { kind: 'reactor' })
    await plugins.remove('u1', 'p1', 'kanban')
    await feed.settle()
    expect(t.unbound).toEqual([])
    await plugins.remove('u1', '', 'kanban')
    await feed.settle()
    expect(t.unbound).toEqual(['plugin:kanban'])
    expect((await t.rules.read('u1', 'a1')).some((r) => r.action === 'plugin:kanban')).toBe(false)
    await feed.close()
  })
})
