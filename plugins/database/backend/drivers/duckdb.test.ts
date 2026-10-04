import { describe, expect, test } from 'bun:test'
import { createDuckDbDriver, duckDbIndexColumns } from './duckdb'

describe('DuckDB driver', () => {
  test('implements the standard query, browse and metadata ports in memory', async () => {
    const driver = createDuckDbDriver({ file: ':memory:' })
    try {
      expect(driver.getFlags()).toMatchObject({
        dialect: 'duckdb',
        kind: 'sql',
        supportsMultipleSchemas: true,
        supportsCancel: true,
      })
      await driver.query(`
        CREATE TABLE users (
          id BIGINT PRIMARY KEY,
          email VARCHAR UNIQUE,
          created_at TIMESTAMP DEFAULT current_timestamp
        )
      `)
      await driver.query('INSERT INTO users (id, email) VALUES (?, ?)', [1, 'ada@example.com'])
      const result = await driver.query('SELECT id, email FROM users WHERE id = ?', [1])
      expect(result.columns.map((column) => column.name)).toEqual(['id', 'email'])
      expect(result.rows).toEqual([[1, 'ada@example.com']])

      const schemas = await driver.schemas()
      expect(schemas.main).toContainEqual({ name: 'users', type: 'table' })
      const table = await driver.tableSchema('main', 'users')
      expect(table.primaryKey).toEqual(['id'])
      expect(table.columns.find((column) => column.name === 'email')?.dataType).toBe('VARCHAR')
      expect(table.indexes.some((index) => index.primary)).toBe(true)
      expect(
        table.indexes.find((index) => index.columns.length === 1 && index.columns[0] === 'email'),
      ).toMatchObject({ unique: true, constraint: true })

      const page = await driver.browse({
        schema: 'main',
        table: 'users',
        limit: 50,
        offset: 0,
      })
      expect(page.rows).toEqual([[1, 'ada@example.com', expect.any(String)]])
    } finally {
      await driver.close()
    }
  })

  test('keeps a manual transaction on the same standard driver handle', async () => {
    const driver = createDuckDbDriver({ file: ':memory:' })
    try {
      await driver.query('CREATE TABLE events (id INTEGER)')
      const transaction = await driver.beginTransaction?.()
      expect(transaction).toBeDefined()
      await transaction!.query('INSERT INTO events VALUES (1)')
      await transaction!.rollback()
      expect((await driver.query('SELECT * FROM events')).rows).toEqual([])
    } finally {
      await driver.close()
    }
  })

  test('isolates concurrent work from manual and batch transactions on its single handle', async () => {
    const driver = createDuckDbDriver({ file: ':memory:' })
    try {
      await driver.query('CREATE TABLE isolated (id INTEGER PRIMARY KEY)')
      const manual = await driver.beginTransaction?.()
      await manual!.query('INSERT INTO isolated VALUES (1)')
      let outsideFinished = false
      const outside = driver.query('INSERT INTO isolated VALUES (2)').then(() => {
        outsideFinished = true
      })
      await Promise.resolve()
      expect(outsideFinished).toBe(false)
      await manual!.rollback()
      await outside
      expect((await driver.query('SELECT id FROM isolated ORDER BY id')).rows).toEqual([[2]])

      await Promise.all([
        driver.transaction!([
          { sql: 'INSERT INTO isolated VALUES (3)' },
          { sql: 'INSERT INTO isolated VALUES (4)' },
        ]),
        driver.transaction!([{ sql: 'INSERT INTO isolated VALUES (5)' }]),
      ])
      expect((await driver.query('SELECT id FROM isolated ORDER BY id')).rows).toEqual([
        [2],
        [3],
        [4],
        [5],
      ])
    } finally {
      await driver.close()
    }
  })

  test('preserves BLOB identity and index column names containing commas', async () => {
    const driver = createDuckDbDriver({ file: ':memory:' })
    try {
      await driver.query('CREATE TABLE artifacts ("part,name" VARCHAR, payload BLOB)')
      await driver.query('CREATE INDEX artifacts_part ON artifacts ("part,name")')
      await driver.query(`INSERT INTO artifacts VALUES ('manifest', from_hex('00ff1a'))`)

      const result = await driver.query('SELECT payload FROM artifacts')
      expect(Buffer.isBuffer(result.rows[0]?.[0])).toBe(true)
      expect(result.rows[0]?.[0]).toEqual(Buffer.from([0x00, 0xff, 0x1a]))

      const table = await driver.tableSchema('main', 'artifacts')
      expect(table.indexes).toContainEqual({
        name: 'artifacts_part',
        columns: ['part,name'],
        unique: false,
        primary: false,
        createScript: 'CREATE INDEX artifacts_part ON artifacts("part,name");',
      })
    } finally {
      await driver.close()
    }
  })

  test('keeps exact decimal and temporal values without sacrificing nested BLOBs', async () => {
    const driver = createDuckDbDriver({ file: ':memory:' })
    try {
      const result = await driver.query(`
        SELECT
          1::BIGINT AS safe_bigint,
          9007199254740993::BIGINT AS exact_bigint,
          CAST('12345678901234567890.12' AS DECIMAL(38, 2)) AS exact_decimal,
          TIME '12:34:56.123456' AS exact_time,
          TIMESTAMP '2024-01-01 12:34:56.123456' AS exact_timestamp,
          [from_hex('00ff')] AS nested_blobs
      `)
      expect(result.rows).toEqual([
        [
          1,
          '9007199254740993',
          '12345678901234567890.12',
          '12:34:56.123456',
          '2024-01-01 12:34:56.123456',
          [Buffer.from([0x00, 0xff])],
        ],
      ])
    } finally {
      await driver.close()
    }
  })
})

describe('DuckDB index SQL parsing', () => {
  test('splits only top-level commas and unescapes quoted identifiers', () => {
    expect(
      duckDbIndexColumns(
        'CREATE INDEX idx ON records (coalesce(first_name, last_name), "odd,""name");',
      ),
    ).toEqual(['coalesce(first_name, last_name)', 'odd,"name'])
  })
})
