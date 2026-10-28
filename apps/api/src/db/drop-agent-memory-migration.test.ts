/**
 * Memory is Claude Code's auto memory folder now (`features/memory/auto-memory.ts`), so the
 * `agent_memory` table the retired `memory` tool once wrote is gone from a migrated database.
 */
import { afterEach, expect, test } from 'bun:test'
import { sql, type Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import type { AppDatabase } from './types'

const databases: Kysely<AppDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)))
})

test('a migrated database has no agent_memory table', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const tables = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE name LIKE 'agent_memory%'`.execute(db)
  expect(tables.rows).toEqual([])
})
