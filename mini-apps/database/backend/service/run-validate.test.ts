/**
 * Pre-run validation asks the ENGINE to compile each statement — real SQLite here —
 * and must never execute one. The console's name checks could not see `SELEC * FROM users`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import type { DbDriver, DbValidation } from '../drivers/port'
import { createSqliteDriver } from '../drivers/sqlite'
import type { LiveEntry } from './live-entry'
import { runQuery } from './run-query'
import { runValidate, VALIDATE_STATEMENT_LIMIT } from './run-validate'

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

describe.each([
  ['sqlite', () => createSqliteDriver({ file: ':memory:' }), 'SQLITE_ERROR'],
] as const)('%s validate', (_name, makeDriver, syntaxCode) => {
  it('locates a syntax error at the engine-reported offset, relative to the whole text', async () => {
    const live = liveOf(makeDriver())
    await runQuery(live, 'CREATE TABLE users(id INTEGER)')
    const text = 'SELECT 1;\nSELEC * FROM users'
    const { supported, results } = await runValidate(live, text)
    expect(supported).toBe(true)
    expect(results[0]).toEqual({ statementStart: 0, ok: true })
    expect(results[1]).toMatchObject({
      statementStart: text.indexOf('SELEC '),
      ok: false,
      offset: text.indexOf('SELEC '),
      code: syntaxCode,
    })
  })

  it('reports an unknown table, and passes a valid statement', async () => {
    const live = liveOf(makeDriver())
    await runQuery(live, 'CREATE TABLE users(id INTEGER)')
    const { results } = await runValidate(live, 'SELECT * FROM nope; SELECT id FROM users')
    expect(results[0]).toMatchObject({ ok: false })
    expect(results[0]!.message).toContain('nope')
    expect(results[1]).toMatchObject({ ok: true })
  })

  it('compiles DDL without executing it', async () => {
    const live = liveOf(makeDriver())
    await runQuery(live, 'CREATE TABLE users(id INTEGER); INSERT INTO users VALUES (1)')
    const { results } = await runValidate(live, 'DROP TABLE users; CREATE TABLE extra(a INTEGER)')
    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect((await runQuery(live, 'SELECT COUNT(*) FROM users')).result.rows).toEqual([[1]])
    expect(runQuery(live, 'SELECT * FROM extra')).rejects.toBeDefined()
  })

  it('does not call a name an error when an earlier statement of the text creates it', async () => {
    const live = liveOf(makeDriver())
    const { results } = await runValidate(
      live,
      'CREATE TABLE fresh(a INTEGER); INSERT INTO fresh VALUES (1); SELECT nope FROM missing',
    )
    expect(results[1]).toMatchObject({ ok: true, skipped: 'depends-on-earlier' })
    expect(results[2]).toMatchObject({ ok: true, skipped: 'depends-on-earlier' })
  })

  it('answers busy instead of waiting while a manual transaction holds the connection', async () => {
    const live = liveOf(makeDriver())
    const tx = await live.driver.beginTransaction!()
    try {
      const { results } = await runValidate(live, 'SELEC 1')
      expect(results).toEqual([{ statementStart: 0, ok: true, skipped: 'busy' }])
    } finally {
      await tx.rollback()
    }
  })
})

describe('sqlite offsets', () => {
  it('converts the engine UTF-8 byte offset to a UTF-16 editor offset', async () => {
    const live = liveOf(createSqliteDriver({ file: ':memory:' }))
    await runQuery(live, 'CREATE TABLE users(id INTEGER)')
    const text = "SELECT 'é🙂', nope FROM users"
    const [result] = (await runValidate(live, text)).results
    expect(result).toMatchObject({ ok: false, offset: text.indexOf('nope') })
  })
})

/** A driver whose verdicts are scripted per statement text. */
function scripted(verdicts: Record<string, DbValidation>, nativeScripts = false) {
  const seen: string[] = []
  const driver = {
    nativeScripts,
    getFlags: () => ({ dialect: 'postgres', kind: 'sql' }),
    async query() {
      return { columns: [], rows: [], durationMs: 0 }
    },
    async validate(sql: string) {
      seen.push(sql)
      return verdicts[sql] ?? { ok: true }
    },
    async close() {},
  } as unknown as DbDriver
  return { driver, seen }
}

describe('runValidate policy', () => {
  it('reports unsupported for an engine without a compile check, and for non-SQL engines', async () => {
    const live = liveOf({
      getFlags: () => ({ dialect: 'redis', kind: 'kv' }),
      async close() {},
    } as unknown as DbDriver)
    expect(await runValidate(live, 'GET k')).toEqual({ supported: false, results: [] })
  })

  it('keeps a syntax error after DDL, but not a name error, and ignores a failed definer', async () => {
    const { driver } = scripted({
      'CREATE TABLEE t(a int)': { ok: false, message: 'syntax', offset: 7 },
      'SELECT * FROM t': { ok: false, message: 'unknown t', semantic: true },
      'SELEC 1': { ok: false, message: 'syntax' },
    })
    const text = 'CREATE TABLEE t(a int); SELECT * FROM t; CREATE TABLE u(a int); SELEC 1'
    const { results } = await runValidate(liveOf(driver), text)
    expect(results.map((r) => [r.ok, r.skipped, r.offset])).toEqual([
      [false, undefined, 7],
      // The only earlier definer failed to compile, so it defines nothing: still an error.
      [false, undefined, undefined],
      [true, undefined, undefined],
      [false, undefined, undefined],
    ])
  })

  it('validates a native-batch engine once, as a whole', async () => {
    const { driver, seen } = scripted({}, true)
    await runValidate(liveOf(driver), '  DECLARE @x int = 1; SELECT @x  ')
    expect(seen).toEqual(['DECLARE @x int = 1; SELECT @x'])
  })

  it('bounds the number of statements compiled per request', async () => {
    const { driver, seen } = scripted({})
    const text = Array.from({ length: VALIDATE_STATEMENT_LIMIT + 2 }, () => 'SELECT 1').join(';')
    const { results } = await runValidate(liveOf(driver), text)
    expect(seen).toHaveLength(VALIDATE_STATEMENT_LIMIT)
    expect(results.at(-1)).toMatchObject({ ok: true, skipped: 'limit' })
  })

  it('treats a throwing driver check as no verdict', async () => {
    const live = liveOf({
      getFlags: () => ({ dialect: 'postgres', kind: 'sql' }),
      async validate() {
        throw new Error('socket closed')
      },
      async close() {},
    } as unknown as DbDriver)
    expect((await runValidate(live, 'SELECT 1')).results).toEqual([
      { statementStart: 0, ok: true, skipped: 'busy' },
    ])
  })
})
