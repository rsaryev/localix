import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import type { Migration, MigrationProvider } from 'kysely/migration'
import * as baseline from '../../migrations/20260601T000000_init_schema'
import { createDatabase, destroyDatabase } from './connection'
import { BASELINE_MIGRATION } from './migration-provider'
import { migrateToLatest } from './migrator'
import type { AppDatabase } from './types'

const databases: Kysely<AppDatabase>[] = []
const database = (filename?: string) => {
  const db = createDatabase(filename ? { filename } : {})
  databases.push(db)
  return db
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)))
})

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'localix-migrator-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** The real baseline plus the given forward migrations, without a folder on disk. */
const migrationsWith = (extra: Record<string, Migration> = {}): MigrationProvider => ({
  getMigrations: async () => ({ [BASELINE_MIGRATION]: baseline, ...extra }),
})

const ADD_NOTE: Record<string, Migration> = {
  '20260924T000000_add_session_note': {
    up: async (db) => {
      await sql`ALTER TABLE agent_sessions ADD COLUMN note TEXT`.execute(db)
    },
  },
}

const tables = async (db: Kysely<AppDatabase>) =>
  (
    await sql<{ name: string }>`
      SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `.execute(db)
  ).rows.map((row) => row.name)

const ledger = async (db: Kysely<AppDatabase>) =>
  (
    await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db)
  ).rows.map((row) => row.name)

describe('forward migrations', () => {
  test('a fresh database gets the baseline, and a second start changes nothing', async () => {
    const db = database()
    const migrations = migrationsWith()
    expect((await migrateToLatest(db, { migrations })).map((r) => r.migrationName)).toEqual([
      BASELINE_MIGRATION,
    ])
    await db.deleteFrom('capability_source').execute()
    expect(await migrateToLatest(db, { migrations })).toEqual([])
    expect(await db.selectFrom('capability_source').selectAll().execute()).toEqual([])
  })

  test('an existing database takes the pending migration and keeps its rows', async () => {
    const db = database()
    await migrateToLatest(db, { migrations: migrationsWith() })
    const before = await db.selectFrom('capability_source').select('name').execute()

    const results = await migrateToLatest(db, { migrations: migrationsWith(ADD_NOTE) })

    expect(results.map((r) => r.migrationName)).toEqual(['20260924T000000_add_session_note'])
    expect(await db.selectFrom('capability_source').select('name').execute()).toEqual(before)
    const columns = await sql<{ name: string }>`PRAGMA table_xinfo(agent_sessions)`.execute(db)
    expect(columns.rows.map((row) => row.name)).toContain('note')
    expect(await ledger(db)).toEqual([BASELINE_MIGRATION, '20260924T000000_add_session_note'])
  })

  // The reason the SQLite adapter reports transactional DDL: without it the Migrator ran each
  // migration bare, and the ALTER below would stay applied with no ledger row describing it.
  test('a migration that fails leaves the schema and the ledger as they were', async () => {
    const db = database()
    await migrateToLatest(db, { migrations: migrationsWith() })
    const failing: Record<string, Migration> = {
      '20260924T000000_half_done': {
        up: async (trx) => {
          await sql`ALTER TABLE agent_sessions ADD COLUMN half TEXT`.execute(trx)
          throw new Error('second statement failed')
        },
      },
    }
    await expect(migrateToLatest(db, { migrations: migrationsWith(failing) })).rejects.toThrow(
      'second statement failed',
    )
    const columns = await sql<{ name: string }>`PRAGMA table_xinfo(agent_sessions)`.execute(db)
    expect(columns.rows.map((row) => row.name)).not.toContain('half')
    expect(await ledger(db)).toEqual([BASELINE_MIGRATION])
  })

  test('a database that ran a migration this build does not have is refused untouched', async () => {
    const db = database()
    await migrateToLatest(db, { migrations: migrationsWith(ADD_NOTE) })
    await expect(migrateToLatest(db, { migrations: migrationsWith() })).rejects.toThrow(
      '20260924T000000_add_session_note',
    )
    expect(await ledger(db)).toEqual([BASELINE_MIGRATION, '20260924T000000_add_session_note'])
  })

  test('tables the migrations do not define are refused, and nothing is written', async () => {
    const db = database()
    await sql`CREATE TABLE old_data (value TEXT)`.execute(db)
    await sql`INSERT INTO old_data VALUES ('Keep this data')`.execute(db)
    await expect(migrateToLatest(db, { migrations: migrationsWith() })).rejects.toThrow(
      'unexpected table old_data',
    )
    expect(await tables(db)).toEqual(['old_data'])
    expect((await sql`SELECT * FROM old_data`.execute(db)).rows).toEqual([
      { value: 'Keep this data' },
    ])
  })

  for (const [statement, found] of [
    ['DROP TABLE agent_delivery_receipts', 'missing table agent_delivery_receipts'],
    ['DROP INDEX agent_sessions_tree_idx', 'missing index agent_sessions_tree_idx'],
    ['DROP TRIGGER agent_messages_fts_insert', 'missing trigger agent_messages_fts_insert'],
    ['ALTER TABLE skill_usage DROP COLUMN archived_at', 'changed table skill_usage'],
  ]) {
    test(`drift is refused and the pending migration rolled back: ${found}`, async () => {
      const db = database()
      await migrateToLatest(db, { migrations: migrationsWith() })
      await sql.raw(statement!).execute(db)
      await expect(migrateToLatest(db, { migrations: migrationsWith(ADD_NOTE) })).rejects.toThrow(
        found!,
      )
      expect(await ledger(db)).toEqual([BASELINE_MIGRATION])
    })
  }

  test('an existing file database is snapshotted before a pending migration, not before a no-op', async () => {
    const file = join(dir, 'snapshot.sqlite')
    const db = database(file)
    await migrateToLatest(db, { migrations: migrationsWith() })
    const backups = () => {
      try {
        return readdirSync(join(dir, 'backups', 'migrations'))
      } catch {
        return []
      }
    }
    expect(backups()).toEqual([])
    await migrateToLatest(db, { migrations: migrationsWith() })
    expect(backups()).toEqual([])
    await migrateToLatest(db, { migrations: migrationsWith(ADD_NOTE) })
    expect(backups()).toHaveLength(1)
  })
})
