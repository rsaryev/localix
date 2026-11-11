import { afterEach, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { up } from '../../migrations/20261120T000000_plugin_agent_own_plugin'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

/**
 * A plugin's agent starts with its own plugin on. One bound before that rule has no rule on its
 * plugin at all, so it ran without its own skills and hooks: it gets the rule a new one starts
 * with. One whose own plugin someone switched off or on keeps what they chose, and an agent from a
 * folder is not a plugin's.
 */
test("a plugin's agent bound before the rule gets its own plugin on; a choice made stays", async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const agent = (name: string, source: string) => ({
    id: `row-${name}`,
    user_id: 'u1',
    kind: 'agent',
    project_id: '',
    name,
    config: '{}',
    source,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  })
  await db
    .insertInto('capability_source')
    .values([
      agent('cc:old', 'plugin:acme'),
      agent('cc:off', 'plugin:acme'),
      agent('cc:mine', 'user'),
    ])
    .execute()
  const rule = (agentId: string, position: number, action: string, effect = 'deny') => ({
    user_id: 'u1',
    agent_id: agentId,
    position,
    action,
    resource: '*',
    effect,
  })
  await db
    .insertInto('capability_rule')
    .values([
      rule('cc:old', 0, 'tool:Bash'),
      rule('cc:old', 1, 'tool:Write'),
      rule('cc:off', 0, 'tool:Bash'),
      rule('cc:off', 1, 'plugin:acme'),
      rule('cc:mine', 0, 'tool:Bash'),
    ])
    .execute()

  await up(db as unknown as Kysely<unknown>)
  await up(db as unknown as Kysely<unknown>)

  const rows = await db
    .selectFrom('capability_rule')
    .select(['agent_id', 'position', 'action', 'effect'])
    .orderBy('agent_id')
    .orderBy('position')
    .execute()
  expect(rows).toEqual([
    { agent_id: 'cc:mine', position: 0, action: 'tool:Bash', effect: 'deny' },
    { agent_id: 'cc:off', position: 0, action: 'tool:Bash', effect: 'deny' },
    { agent_id: 'cc:off', position: 1, action: 'plugin:acme', effect: 'deny' },
    { agent_id: 'cc:old', position: 0, action: 'tool:Bash', effect: 'deny' },
    { agent_id: 'cc:old', position: 1, action: 'tool:Write', effect: 'deny' },
    { agent_id: 'cc:old', position: 2, action: 'plugin:acme', effect: 'allow' },
  ])
})
