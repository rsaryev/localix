/**
 * The row cap against a REAL in-process engine. SQLite runs in this process, so the
 * claim "a driver never holds more than cap+1 rows" can be checked end to end here; the network
 * drivers are checked at their streaming seam in their own tests.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { capRows, createRowCollector, RESULT_ROW_CAP } from '../../shared/result-cap'
import type { DbDriver } from './port'
import { createSqliteDriver } from './sqlite'

const OVER = RESULT_ROW_CAP + 1

let driver: DbDriver | undefined
afterEach(async () => {
  await driver?.close()
  driver = undefined
})

describe('the collector', () => {
  test('holds the cap, flags the first row past it, and says when reading may stop', () => {
    const collector = createRowCollector(2)
    expect(collector.push([1])).toBe(false)
    expect(collector.push([2])).toBe(false)
    expect(collector.truncated).toBe(false)
    expect(collector.push([3])).toBe(true)
    expect(collector.rows).toEqual([[1], [2]])
    expect(collector.truncated).toBe(true)
  })

  test('exactly the cap is NOT truncated — that is why N+1 is read', () => {
    expect(capRows([[1], [2]], 2)).toEqual({ rows: [[1], [2]], truncated: false })
    expect(capRows([[1], [2], [3]], 2)).toEqual({ rows: [[1], [2]], truncated: true })
  })
})

describe('sqlite', () => {
  const series = (n: number) =>
    `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${n}) SELECT n FROM s`

  test('a result over the cap comes back capped and flagged', async () => {
    driver = createSqliteDriver({ file: ':memory:' })
    const result = await driver.query(series(OVER + 500))
    expect(result.rows).toHaveLength(RESULT_ROW_CAP)
    expect(result.rows.at(-1)).toEqual([RESULT_ROW_CAP])
    expect(result.truncated).toBe(true)
  })

  test('a result at the cap is whole', async () => {
    driver = createSqliteDriver({ file: ':memory:' })
    const result = await driver.query(series(RESULT_ROW_CAP))
    expect(result.rows).toHaveLength(RESULT_ROW_CAP)
    expect(result.truncated).toBeUndefined()
  })

  test('repeated column names stay positional, capped after the read', async () => {
    driver = createSqliteDriver({ file: ':memory:' })
    const small = await driver.query('SELECT 1 AS id, 2 AS id')
    expect(small.rows).toEqual([[1, 2]])
    const big = await driver.query(
      series(OVER).replace('SELECT n FROM s', 'SELECT n AS id, -n AS id FROM s'),
    )
    expect(big.rows).toHaveLength(RESULT_ROW_CAP)
    expect(big.rows[0]).toEqual([1, -1])
    expect(big.truncated).toBe(true)
  })

  test('a writing statement runs to the end even when its RETURNING rows are capped', async () => {
    driver = createSqliteDriver({ file: ':memory:' })
    await driver.query('CREATE TABLE t (n INTEGER)')
    const result = await driver.query(`INSERT INTO t ${series(OVER)} RETURNING n`)
    expect(result.truncated).toBe(true)
    const count = await driver.query('SELECT count(*) FROM t')
    expect(count.rows).toEqual([[OVER]])
  })
})
