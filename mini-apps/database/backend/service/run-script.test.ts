/**
 * A multi-statement console text runs EVERY statement.
 *
 * The regression: `createSqliteDriver().query('CREATE TABLE …; INSERT …')` ran only the CREATE
 * (bun:sqlite `prepare` compiles the first statement and ignores the rest) and reported
 * success with `rowsAffected: 0`; the rows never existed. These tests run the real SQLite
 * adapter through `runQuery`, the path the console route and `db_query` share.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createExclusiveQueue } from '../drivers/exclusive-queue'
import type { DbDriver, DbResultSet } from '../drivers/port'
import { createSqliteDriver } from '../drivers/sqlite'
import { statementFailureOf } from '../errors'
import type { LiveEntry } from './live-entry'
import { combineResults } from './run-script'
import { runQuery } from './run-query'

const open: DbDriver[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((driver) => driver.close()))
})

function liveOf(driver: DbDriver): LiveEntry {
  open.push(driver)
  return {
    driver,
    flags: driver.getFlags(),
    readonly: false,
    serverReadOnly: false,
    inflight: new Map(),
    inflightOperations: new Set(),
    inflightMetadata: new Set(),
    closing: false,
    recentQueries: [],
  }
}

const count = async (live: LiveEntry) =>
  (await runQuery(live, 'SELECT COUNT(*) AS n FROM users')).result.rows[0]?.[0]

describe.each([['sqlite', () => createSqliteDriver({ file: ':memory:' })]] as const)(
  '%s script run',
  (_name, makeDriver) => {
    it('runs every statement of a two-statement text (the silent-drop repro)', async () => {
      const live = liveOf(makeDriver())
      const res = await runQuery(
        live,
        "CREATE TABLE users(id INTEGER, name TEXT); INSERT INTO users VALUES (1, 'a'), (2, 'b');",
      )
      expect(res.statements).toEqual({ total: 2, executed: 2 })
      expect(res.result.rowsAffected).toBe(2)
      expect(await count(live)).toBe(2)
    })

    it('returns the last row-returning result and counts every statement', async () => {
      const live = liveOf(makeDriver())
      const res = await runQuery(
        live,
        'CREATE TABLE users(id INTEGER);\nINSERT INTO users VALUES (1);\nSELECT id FROM users;\nSELECT 42 AS answer;\n-- trailing note',
      )
      expect(res.statements).toEqual({ total: 4, executed: 4 })
      expect(res.result.columns.map((column) => column.name)).toEqual(['answer'])
      expect(res.result.rows).toEqual([[42]])
    })

    it('stops at the first failing statement and says where', async () => {
      const live = liveOf(makeDriver())
      const text =
        'CREATE TABLE users(id INTEGER); INSERT INTO nope VALUES (1); INSERT INTO users VALUES (1)'
      const err = await runQuery(live, text).catch((error: unknown) => error)
      expect(statementFailureOf(err)).toEqual({
        index: 1,
        total: 3,
        executed: 1,
        start: text.indexOf('INSERT INTO nope'),
      })
      // The statement before the failure was applied; the one after it never ran.
      expect(await count(live)).toBe(0)
    })

    it('refuses bound parameters with more than one statement before anything runs', async () => {
      const live = liveOf(makeDriver())
      await runQuery(live, 'CREATE TABLE users(id INTEGER)')
      expect(
        runQuery(live, 'INSERT INTO users VALUES (?); INSERT INTO users VALUES (?)', [1, 2]),
      ).rejects.toMatchObject({ code: 'script_params' })
      expect(await count(live)).toBe(0)
    })

    it('keeps a single statement on the untouched single-statement path', async () => {
      const live = liveOf(makeDriver())
      const res = await runQuery(live, 'SELECT 1 AS one; -- a note, not a statement')
      expect(res.statements).toBeUndefined()
      expect(res.result.rows).toEqual([[1]])
    })

    it('runs the script inside an open manual transaction, so Rollback undoes all of it', async () => {
      const live = liveOf(makeDriver())
      await runQuery(live, 'CREATE TABLE users(id INTEGER)')
      const tx = await live.driver.beginTransaction!()
      live.activeTx = tx
      live.activeTxQueue = createExclusiveQueue()
      const res = await runQuery(live, 'INSERT INTO users VALUES (1); INSERT INTO users VALUES (2)')
      expect(res.statements).toEqual({ total: 2, executed: 2 })
      await tx.rollback()
      live.activeTx = undefined
      live.activeTxQueue = undefined
      expect(await count(live)).toBe(0)
    })
  },
)

describe('sqlite script bodies', () => {
  it('runs a trigger whose body holds semicolons as ONE statement', async () => {
    const live = liveOf(createSqliteDriver({ file: ':memory:' }))
    const res = await runQuery(
      live,
      `CREATE TABLE users(id INTEGER); CREATE TABLE audit(n INTEGER);
       CREATE TRIGGER t AFTER INSERT ON users BEGIN INSERT INTO audit VALUES (1); INSERT INTO audit VALUES (2); END;
       INSERT INTO users VALUES (1);
       SELECT COUNT(*) FROM audit`,
    )
    expect(res.statements).toEqual({ total: 5, executed: 5 })
    expect(res.result.rows).toEqual([[2]])
  })
})

describe('native script engines', () => {
  it('sends the whole text once to a driver that declares nativeScripts', async () => {
    const seen: string[] = []
    const driver = {
      nativeScripts: true,
      getFlags: () => ({ dialect: 'mssql', kind: 'sql' }),
      async query(sql: string) {
        seen.push(sql)
        return { columns: [], rows: [], durationMs: 0 }
      },
      async close() {},
    } as unknown as DbDriver
    const live = liveOf(driver)
    const res = await runQuery(live, 'DECLARE @x int = 1; SELECT @x')
    expect(seen).toEqual(['DECLARE @x int = 1; SELECT @x'])
    expect(res.statements).toBeUndefined()
  })
})

describe('combineResults', () => {
  const set = (partial: Partial<DbResultSet>): DbResultSet => ({
    columns: [],
    rows: [],
    durationMs: 1,
    ...partial,
  })

  it('sums write counts when no statement returned rows, keeping the last insert id', () => {
    expect(
      combineResults([
        set({ rowsAffected: 2, lastInsertId: 5 }),
        set({}),
        set({ rowsAffected: 3 }),
      ]),
    ).toEqual({ columns: [], rows: [], rowsAffected: 5, lastInsertId: 5, durationMs: 3 })
  })
})
