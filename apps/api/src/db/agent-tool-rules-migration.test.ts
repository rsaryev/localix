import { afterEach, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'

import { up } from '../../migrations/20261111T000000_agent_tool_rules'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

/**
 * `delegate` became Claude Code's `Agent`. A rule written for the old name — the tool switched off
 * for an agent, or one agent type denied — must keep governing the same calls: left as it was, the
 * tool it switched off would quietly come back on.
 */
test('a rule written for delegate governs Agent', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const rule = (position: number, action: string, resource = '*') => ({
    user_id: 'u1',
    agent_id: 'native:qa',
    position,
    action,
    resource,
    effect: 'deny',
  })
  await db
    .insertInto('capability_rule')
    .values([rule(0, 'tool:delegate'), rule(1, 'tool:delegate', 'Explore'), rule(2, 'tool:Bash')])
    .execute()

  await up(db as unknown as Kysely<unknown>)

  const rows = await db
    .selectFrom('capability_rule')
    .select(['action', 'resource'])
    .orderBy('position')
    .execute()
  expect(rows).toEqual([
    { action: 'tool:Agent', resource: '*' },
    { action: 'tool:Agent', resource: 'Explore' },
    { action: 'tool:Bash', resource: '*' },
  ])
})
