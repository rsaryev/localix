import { afterEach, expect, test } from 'bun:test'
import { sql, CompiledQuery } from 'kysely'
import { createDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { delegatedRunsQuery } from '../features/chat/repository-delegated-runs'
import {
  delegationRecoveryQuery,
  recoveryUsersQuery,
} from '../features/chat/repository-delegation-recovery'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})
async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  return db
}

async function unindexedForeignKeys(db: ReturnType<typeof createDatabase>) {
  const tables = (
    await sql<{
      name: string
    }>`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`.execute(db)
  ).rows
  const missing: string[] = []
  for (const { name } of tables) {
    const keys = (
      await sql<{
        id: number
        seq: number
        from: string
      }>`SELECT id, seq, "from" FROM pragma_foreign_key_list(${name}) ORDER BY id, seq`.execute(db)
    ).rows
    if (!keys.length) continue
    const indexes = (
      await sql<{
        name: string
      }>`SELECT name FROM pragma_index_list(${name}) WHERE partial=0`.execute(db)
    ).rows
    const prefixes = await Promise.all(
      indexes.map(async (index) =>
        (
          await sql<{
            name: string
          }>`SELECT name FROM pragma_index_info(${index.name}) ORDER BY seqno`.execute(db)
        ).rows.map((column) => column.name),
      ),
    )
    for (const id of new Set(keys.map((key) => key.id))) {
      const columns = keys.filter((key) => key.id === id).map((key) => key.from)
      if (!prefixes.some((prefix) => columns.every((column, offset) => prefix[offset] === column)))
        missing.push(`${name}(${columns.join(',')})`)
    }
  }
  return missing
}

test('all foreign-key child lookups have leading indexes, including cascade deletes', async () => {
  const db = await fixture()
  expect(await unindexedForeignKeys(db)).toEqual([])
  await sql`DROP INDEX agent_delivery_receipts_session_idx`.execute(db)
  expect(await unindexedForeignKeys(db)).toContain('agent_delivery_receipts(session_id)')
})

test('text primary keys reject NULL and timestamp defaults use sortable UTC ISO format', async () => {
  const db = await fixture()
  const nullableKeys = await sql<{ table_name: string; column_name: string }>`
    SELECT s.name AS table_name, c.name AS column_name
    FROM sqlite_schema s, pragma_table_info(s.name) c
    WHERE s.type='table' AND s.name NOT LIKE 'sqlite_%' AND s.name NOT LIKE 'kysely_%'
      AND c.pk > 0 AND upper(c.type) = 'TEXT' AND c."notnull" = 0
  `.execute(db)
  expect(nullableKeys.rows).toEqual([])
  await expect(sql`INSERT INTO user_profiles (user_id) VALUES (NULL)`.execute(db)).rejects.toThrow(
    'NOT NULL',
  )
  await sql`INSERT INTO projects (id,user_id,name,working_dir) VALUES ('p','u','Test','/tmp/test')`.execute(
    db,
  )
  const project = await db.selectFrom('projects').select('created_at').executeTakeFirstOrThrow()
  expect(project.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  expect((await sql`PRAGMA integrity_check`.execute(db)).rows).toEqual([{ integrity_check: 'ok' }])
  expect((await sql`PRAGMA foreign_key_check`.execute(db)).rows).toEqual([])
})

async function plan(
  db: ReturnType<typeof createDatabase>,
  query: { sql: string; parameters: readonly unknown[] },
) {
  return (
    await db.executeQuery<{ detail: string }>(
      CompiledQuery.raw(`EXPLAIN QUERY PLAN ${query.sql}`, [...query.parameters]),
    )
  ).rows
    .map((row) => row.detail)
    .join('\n')
}

test('production delegation queries use scoped indexes and bounded latest-message reads', async () => {
  const db = await fixture()
  // One session's own children: the parent index, not a walk of the whole tree.
  const progress = await plan(db, delegatedRunsQuery(db, 'u', 'root').compile())
  expect(progress).toContain('agent_sessions_parent_idx')
  expect(progress).toContain('agent_messages_session_role_sequence_idx')
  expect(progress).not.toContain('SCAN m')
  // Sorting the bounded items of ONE assistant message is fine; sorting the entire tree is not.
  const recovery = await plan(db, delegationRecoveryQuery(db, 'u', Date.now()).compile())
  expect(recovery).toContain('agent_sessions_recovery_idx')
  expect(recovery).toContain('agent_messages_session_role_sequence_idx')
  expect(recovery).not.toContain('USE TEMP B-TREE')
  // The per-user fan-out reads the same index rather than scanning the session table.
  const users = await plan(db, recoveryUsersQuery(db, Date.now()).compile())
  expect(users).toContain('agent_sessions_recovery_idx')
})
