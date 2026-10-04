import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises'
import path, { join } from 'node:path'
import { sql } from 'kysely'
import { FileMigrationProvider, Migrator } from 'kysely/migration'

import { createDatabase, destroyDatabase } from './connection'
import {
  MIGRATION_DIGEST_TABLE,
  MigrationLedgerError,
  migrationDigest,
  recordMigrationDigests,
  verifyMigrationLedger,
} from './migration-ledger'
import { migrateToLatest } from './migrator'

/**
 * The ledger's promise: a migration a database ran is never silently lost or rewritten. Built on
 * real files in a temp folder and a real database, because the defect was exactly a file renamed
 * on disk after a database had recorded it.
 */
let folder: string
const created: Array<ReturnType<typeof createDatabase>> = []

const migration = (table: string, comment = '') =>
  [
    "import { sql, type Kysely } from 'kysely'",
    comment,
    'export async function up(db: Kysely<unknown>): Promise<void> {',
    `  await sql\`CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL)\`.execute(db)`,
    '}',
    '',
  ].join('\n')

const write = (name: string, text: string) => writeFile(join(folder, `${name}.ts`), text)

/**
 * The ledger's two halves around Kysely's own migrator — what `migrateToLatest` does, without the
 * app-schema housekeeping it runs afterwards (which these toy migrations have no tables for).
 */
async function migrate(db: ReturnType<typeof createDatabase>) {
  const provider = new FileMigrationProvider({ fs, path, migrationFolder: folder })
  await verifyMigrationLedger(db, provider, folder)
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest()
  if (error) throw error
  await recordMigrationDigests(db, folder)
  return results ?? []
}

beforeEach(async () => {
  // Inside the repository: the migration files import `kysely`, which resolves from here only.
  await fs.mkdir(join(process.cwd(), 'tmp'), { recursive: true })
  folder = await mkdtemp(join(process.cwd(), 'tmp', 'migration-ledger-'))
})

afterEach(async () => {
  for (const db of created.splice(0)) await destroyDatabase(db)
  await rm(folder, { recursive: true, force: true })
})

const database = () => {
  const db = createDatabase({ filename: join(folder, 'test.sqlite') })
  created.push(db)
  return db
}

describe('a migration a database ran is immutable', () => {
  test('a renamed applied migration is refused with the file to restore and the rename', async () => {
    await write('20260101T000000_first', migration('first_table'))
    const db = database()
    await migrate(db)
    await rename(
      join(folder, '20260101T000000_first.ts'),
      join(folder, '20260101T000000_first_renamed.ts'),
    )
    const error = await migrate(db).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MigrationLedgerError)
    expect(String(error)).toContain('20260101T000000_first')
    expect(String(error)).toContain('did it become 20260101T000000_first_renamed?')
    expect(String(error)).toContain('NEW migration')
  })

  test('an applied migration whose code changed is refused', async () => {
    await write('20260101T000000_first', migration('first_table'))
    const db = database()
    await migrate(db)
    await write('20260101T000000_first', migration('other_table'))
    const error = await migrate(db).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MigrationLedgerError)
    expect(String(error)).toContain('changed after this database ran them')
  })

  test('reformatting or rewording a comment is not an edit', async () => {
    await write('20260101T000000_first', migration('first_table'))
    const db = database()
    await migrate(db)
    await write(
      '20260101T000000_first',
      `${migration('first_table', '// a reworded comment')}\n\n/* and a block */\n`,
    )
    await write('20260102T000000_second', migration('second_table'))
    await expect(migrate(db)).resolves.toBeDefined()
  })

  test('a new migration beside untouched ones runs, and is recorded', async () => {
    await write('20260101T000000_first', migration('first_table'))
    const db = database()
    await migrate(db)
    await write('20260102T000000_second', migration('second_table'))
    const results = await migrate(db)
    expect(results.map((result) => result.migrationName)).toEqual(['20260102T000000_second'])
  })
})

describe('the real migrator keeps the ledger', () => {
  test('a fresh database records a digest for every shipped migration it ran', async () => {
    const db = createDatabase()
    created.push(db)
    const results = await migrateToLatest(db)
    const rows = await sql<{ n: number }>`
      SELECT count(*) AS n FROM ${sql.table(MIGRATION_DIGEST_TABLE)}
    `.execute(db)
    expect(rows.rows[0]?.n).toBe(results.length)
    // A second start verifies against them and has nothing to do.
    expect(await migrateToLatest(db)).toEqual([])
  })
})

describe('digest', () => {
  test('ignores whitespace and comments, not code', () => {
    const base = migration('t')
    expect(migrationDigest(`${base}\n// note\n`)).toBe(migrationDigest(base))
    expect(migrationDigest(base.replace(/ {2}/g, '\t'))).toBe(migrationDigest(base))
    expect(migrationDigest(migration('u'))).not.toBe(migrationDigest(base))
    // A URL inside code is code, not a comment.
    expect(migrationDigest("const u = 'https://a'")).not.toBe(migrationDigest("const u = 'https:'"))
  })
})
