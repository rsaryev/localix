import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261115T000004_agent_name_column'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

test('a session keeps the name it captured for its agent', async () => {
  const db = createDatabase()
  databases.push(db)
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < BEFORE))
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, agent_id, agent_handle)
    VALUES ('s1', 'u1', 'Chat', 'p1', 'builtin:qa', 'qa')`.execute(db)

  await migrateToLatest(db)

  const rows = await sql<{ agent_name: string }>`SELECT agent_name FROM agent_sessions`.execute(db)
  expect(rows.rows).toEqual([{ agent_name: 'qa' }])
})
