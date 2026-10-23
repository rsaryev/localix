import { describe, expect, test } from 'bun:test'
import { chmod as chmodFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompiledQuery, sql } from 'kysely'

import { createDatabase } from './connection'

/**
 * The database file's PERMISSIONS, which no functional test can notice.
 *
 * The vault encrypts credentials at rest, and two adjacent tables hold others in the CLEAR:
 * `plugins.config` (db/types says outright "may contain secrets") and `mcp_servers.config` (a
 * server's `env` tokens and `Authorization` headers), plus the entire transcript. SQLite creates
 * the file and its `-wal`/`-shm` siblings at the process default — measured 0644 on a real install
 * — so any other local account could read all of it. Meanwhile the migration BACKUP of the same
 * bytes was already written 0600 two functions down in the same file, so the rule was known and
 * applied on one path out of two.
 */
describe('the database file is owner-only', () => {
  test('a fresh database and its WAL sibling are 0600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'db-perm-'))
    try {
      const file = join(dir, 'localix.db')
      const db = createDatabase({ filename: file })
      await db.executeQuery(CompiledQuery.raw('create table t (a integer)'))
      await db.executeQuery(CompiledQuery.raw('insert into t values (1)'))
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      // WAL mode is on (`PRAGMA journal_mode = WAL`), so the sibling exists and carries the same
      // content — an unprotected -wal leaks the most recent writes.
      expect((await stat(`${file}-wal`)).mode & 0o777).toBe(0o600)
      await db.destroy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an existing world-readable database is REPAIRED on open', async () => {
    // The fix has to reach installs that already exist, not only new ones — which is why this
    // repairs on every open instead of setting the mode at create time.
    const dir = await mkdtemp(join(tmpdir(), 'db-perm-'))
    try {
      const file = join(dir, 'localix.db')
      const first = createDatabase({ filename: file })
      await first.executeQuery(CompiledQuery.raw('create table t (a integer)'))
      await first.destroy()
      await chmodFile(file, 0o644)
      expect((await stat(file)).mode & 0o777).toBe(0o644)

      const second = createDatabase({ filename: file })
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      await second.destroy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an in-memory database needs no path work and must not throw', async () => {
    const db = createDatabase({})
    await db.executeQuery(CompiledQuery.raw('create table t (a integer)'))
    await db.executeQuery(CompiledQuery.raw('insert into t (a) values (1)'))
    expect((await db.executeQuery(CompiledQuery.raw('select a from t'))).rows).toEqual([{ a: 1 }])
    await db.destroy()
  })
})

test('SQLite result metadata supports CTEs, comments and mutation RETURNING', async () => {
  const db = createDatabase()
  try {
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)`.execute(db)
    expect(
      (await sql`WITH values_cte AS (SELECT 42 AS n) SELECT n FROM values_cte`.execute(db)).rows,
    ).toEqual([{ n: 42 }])
    expect((await sql`/* leading comment */ SELECT 7 AS n`.execute(db)).rows).toEqual([{ n: 7 }])
    expect(
      (await sql`INSERT INTO t (value) VALUES ('first') RETURNING id,value`.execute(db)).rows,
    ).toEqual([{ id: 1, value: 'first' }])
    expect((await sql`UPDATE t SET value='changed' RETURNING value`.execute(db)).rows).toEqual([
      { value: 'changed' },
    ])
    expect((await sql`DELETE FROM t RETURNING id`.execute(db)).rows).toEqual([{ id: 1 }])
  } finally {
    await db.destroy()
  }
})

test('completed reads, failed writes and cancelled streams release their statements', async () => {
  const db = createDatabase().$extendTables<{ fixture: { id: number } }>()
  try {
    await sql`CREATE TABLE fixture (id INTEGER PRIMARY KEY)`.execute(db)
    await sql`INSERT INTO fixture VALUES (1),(2)`.execute(db)
    await sql`CREATE INDEX fixture_index ON fixture(id)`.execute(db)
    await sql`EXPLAIN QUERY PLAN SELECT * FROM fixture`.execute(db)
    await expect(sql`INSERT INTO fixture VALUES (1)`.execute(db)).rejects.toThrow()
    for await (const row of db.selectFrom('fixture').selectAll().stream()) {
      expect(row.id).toBe(1)
      break
    }
    await sql`DROP INDEX fixture_index`.execute(db)
    await sql`DROP TABLE fixture`.execute(db)
  } finally {
    await db.destroy()
  }
})
