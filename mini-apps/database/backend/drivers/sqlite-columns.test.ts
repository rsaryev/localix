/**
 * bun:sqlite's `columnNames` de-duplicates AND reorders a result's names — `SELECT t.id, t.v,
 * t.id` reported `["v","id"]` over three cells, so the grid put every header over the wrong
 * column. These run the real in-process engine, since the defect is the engine binding's own.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { DbDriver } from './port'
import { createSqliteDriver } from './sqlite'
import { unsuffixRepeatedNames } from './sqlite-rows'

let driver: DbDriver | undefined
afterEach(async () => {
  await driver?.close()
  driver = undefined
})

async function withTable(): Promise<DbDriver> {
  driver = createSqliteDriver({ file: ':memory:' })
  await driver.query('CREATE TABLE t (id INT, v TEXT)')
  await driver.query("INSERT INTO t VALUES (1, 'a')")
  return driver
}

describe('sqlite repeated column names', () => {
  test('a repeated column keeps its own header, in order, over its own cell', async () => {
    const db = await withTable()
    const result = await db.query('SELECT t.id, t.v, t.id FROM t')
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'v', 'id'])
    expect(result.rows).toEqual([[1, 'a', 1]])
  })

  test('a self-join and repeated aliases line up too', async () => {
    const db = await withTable()
    const join = await db.query('SELECT * FROM t a JOIN t b ON a.id = b.id')
    expect(join.columns.map((c) => c.name)).toEqual(['id', 'v', 'id', 'v'])
    const aliases = await db.query('SELECT id AS x, v, id AS x FROM t;')
    expect(aliases.columns.map((c) => c.name)).toEqual(['x', 'v', 'x'])
  })

  test('a write with repeated columns keeps its names, in order, and never runs twice', async () => {
    const db = await withTable()
    const result = await db.query("INSERT INTO t VALUES (2, 'b') RETURNING id, v, id")
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'v', 'id'])
    expect(result.rows).toEqual([[2, 'b', 2]])
    expect((await db.query('SELECT count(*) AS n FROM t')).rows).toEqual([[2]])
  })

  test('unique names are untouched', async () => {
    const db = await withTable()
    expect((await db.query('SELECT id, v FROM t')).columns.map((c) => c.name)).toEqual(['id', 'v'])
  })
})

describe('unsuffixRepeatedNames', () => {
  test('takes a `:N` off only a name that already appeared', () => {
    expect(unsuffixRepeatedNames(['id', 'v', 'id:1', 'v:1'])).toEqual(['id', 'v', 'id', 'v'])
    // A real column called `ratio:2` with no earlier `ratio` is a name, not a repeat.
    expect(unsuffixRepeatedNames(['ratio:2', 'x'])).toEqual(['ratio:2', 'x'])
  })
})
