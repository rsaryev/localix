/**
 * The migration that retires the typed-contribution registry: its two tables and the two revision
 * columns of a capability source go, and the sources themselves, and deleting one, keep working.
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

test('a migrated database has no contribution tables or columns, and sources still delete', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const tables = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
      ('extension_contribution', 'capability_policy_binding')`.execute(db)
  expect(tables.rows).toEqual([])
  const columns = await sql<{ name: string }>`PRAGMA table_info(capability_source)`.execute(db)
  expect(columns.rows.map((row) => row.name)).not.toContain('contribution_revision')
  expect(columns.rows.map((row) => row.name)).not.toContain('contribution_digest')
  await sql`INSERT INTO capability_source (id, user_id, kind, name, created_at, updated_at)
    VALUES ('s', 'u', 'plugin', 'p', 'now', 'now')`.execute(db)
  await sql`DELETE FROM capability_source WHERE id = 's'`.execute(db)
  expect((await sql`SELECT id FROM capability_source WHERE id = 's'`.execute(db)).rows).toEqual([])
})
