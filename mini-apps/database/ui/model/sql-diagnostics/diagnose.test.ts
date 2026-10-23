import { describe, expect, test } from 'bun:test'
import type { DbSchemas, DbTableSchema } from '../../dbClient'
import { createSqlCatalog } from './catalog'
import { diagnoseSql } from './diagnose'

const schemas: DbSchemas = {
  public: [
    { name: 'users', type: 'table' },
    { name: 'orders', type: 'table' },
    { name: 'events', type: 'table' },
  ],
  audit: [{ name: 'log', type: 'table' }],
} as DbSchemas

const structures: Record<string, string[]> = {
  'public.users': ['id', 'name', 'email', 'active', 'created_at'],
  'public.orders': ['id', 'user_id', 'total'],
  'audit.log': ['id', 'message'],
  // public.events: columns deliberately NOT loaded.
}

const getTable = (name: string, schema?: string) => {
  const columns = structures[`${schema}.${name}`]
  return columns
    ? ({ schema, name, columns: columns.map((c) => ({ name: c })) } as unknown as DbTableSchema)
    : undefined
}

const catalog = createSqlCatalog(schemas, getTable)
const run = (sql: string) => diagnoseSql(sql, 'postgres', catalog)
const found = (sql: string) =>
  run(sql).diagnostics.map((d) => ({
    text: sql.slice(d.start, d.end),
    severity: d.severity,
    code: d.code,
  }))

describe('unknown tables', () => {
  test('a table the schema does not have is an error, with the close spelling offered', () => {
    const { diagnostics } = run('SELECT * FROM usres')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.code).toBe('unknown-table')
    expect(diagnostics[0]!.severity).toBe('error')
    expect(diagnostics[0]!.message).toContain('Did you mean "users"?')
  })

  test('every relation position is read: JOIN, comma lists, UPDATE, INSERT INTO, DELETE FROM', () => {
    expect(found('SELECT 1 FROM users, nope JOIN missing m ON true').map((d) => d.text)).toEqual([
      'nope',
      'missing',
    ])
    expect(found('UPDATE ghost SET a = 1').map((d) => d.text)).toEqual(['ghost'])
    expect(found('INSERT INTO ghost (a) VALUES (1)').map((d) => d.text)).toEqual(['ghost'])
    expect(found('DELETE FROM ghost').map((d) => d.text)).toEqual(['ghost'])
  })

  test('a schema-qualified name is judged in its schema, an unlisted schema is not judged', () => {
    expect(found('SELECT * FROM audit.nope').map((d) => d.text)).toEqual(['audit.nope'])
    expect(found('SELECT * FROM audit.log')).toEqual([])
    expect(found('SELECT * FROM other_db.anything')).toEqual([])
  })

  test('names that are not relations of ours never squiggle', () => {
    // Strings and comments, CTEs, table functions, system catalogs, DDL, `IS DISTINCT FROM`.
    expect(found("SELECT 'FROM nope' -- FROM nope\n/* JOIN nope */")).toEqual([])
    expect(found('WITH recent AS (SELECT id FROM users) SELECT * FROM recent')).toEqual([])
    expect(found('SELECT * FROM generate_series(1, 3)')).toEqual([])
    expect(found('SELECT * FROM pg_tables; SELECT * FROM information_schema.tables')).toEqual([])
    expect(found('CREATE TABLE brand_new (id int); DROP TABLE gone')).toEqual([])
    expect(found('SELECT EXTRACT(year FROM created_at) FROM users')).toEqual([])
    expect(found('SELECT * FROM users WHERE id IS DISTINCT FROM 3')).toEqual([])
  })

  test('a table the script itself creates is in scope before the schema reloads', () => {
    expect(found('CREATE TABLE IF NOT EXISTS public.t2 (id int); SELECT * FROM t2')).toEqual([])
    expect(found('CREATE TEMP VIEW v AS SELECT 1; SELECT * FROM v')).toEqual([])
    expect(found('SELECT id INTO scratch FROM users; SELECT * FROM scratch')).toEqual([])
    // …and only those: a different name in the same script still squiggles.
    expect(found('CREATE TABLE t2 (id int); SELECT * FROM t3').map((d) => d.text)).toEqual(['t3'])
  })

  test('nothing is judged before the schema tree has loaded', () => {
    expect(diagnoseSql('SELECT * FROM usres', 'postgres', null).diagnostics).toEqual([])
  })
})

describe('qualified columns', () => {
  test('alias.column that is not on the table is an error with a suggestion', () => {
    const { diagnostics } = run('SELECT u.nmae FROM users u')
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([['unknown-column', 'error']])
    expect(diagnostics[0]!.message).toContain('Did you mean "name"?')
  })

  test('the table name itself qualifies, and a known column passes', () => {
    expect(
      found('SELECT users.id, orders.total FROM users JOIN orders ON orders.user_id = users.id'),
    ).toEqual([])
    expect(found('SELECT orders.nope FROM orders').map((d) => d.text)).toEqual(['nope'])
  })

  test('a qualifier nothing defines is a warning; upsert pseudo-tables are not', () => {
    expect(found('SELECT x.id FROM users u')).toEqual([
      { text: 'x', severity: 'warning', code: 'unknown-alias' },
    ])
    expect(
      found(
        'INSERT INTO users (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET name = excluded.name',
      ),
    ).toEqual([])
  })

  test('a table whose columns have not loaded is asked for, not judged', () => {
    const result = run('SELECT e.whatever FROM events e')
    expect(result.diagnostics).toEqual([])
    expect(result.wantColumns).toEqual([{ name: 'events', schema: 'public' }])
  })
})

describe('bare columns', () => {
  test('an unknown column in an operand position is a warning', () => {
    expect(found('SELECT id, nme FROM users WHERE activ = true')).toEqual([
      { text: 'nme', severity: 'warning', code: 'unknown-column' },
      { text: 'activ', severity: 'warning', code: 'unknown-column' },
    ])
    expect(found('UPDATE users SET emial = 1').map((d) => d.text)).toEqual(['emial'])
    expect(found('INSERT INTO users (id, nmae) VALUES (1, 2)').map((d) => d.text)).toEqual(['nmae'])
  })

  test('aliases, values and keywords standing where a column could are not columns', () => {
    expect(found('SELECT count(*) AS n FROM users ORDER BY n')).toEqual([])
    expect(found('SELECT count(*) total FROM users ORDER BY total DESC')).toEqual([])
    expect(found('SELECT id FROM users WHERE active = TRUE AND created_at > CURRENT_DATE')).toEqual(
      [],
    )
    expect(found("SELECT id FROM users WHERE created_at > DATE '2020-01-01'")).toEqual([])
    expect(found('SELECT id::text FROM users WHERE id = $1 OR id = :id')).toEqual([])
  })

  test('stands down when something else could supply the name', () => {
    // A correlated subquery, a CTE, a table whose columns are not loaded, an unknown table.
    expect(
      found('SELECT id FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = id)'),
    ).toEqual([])
    expect(found('WITH x AS (SELECT 1 AS k) SELECT k FROM x')).toEqual([])
    expect(found('SELECT anything FROM events')).toEqual([])
    expect(found('SELECT anything FROM nope').map((d) => d.code)).toEqual(['unknown-table'])
  })

  test('each statement of a script has its own scope', () => {
    expect(found('SELECT total FROM orders; SELECT total FROM users').map((d) => d.text)).toEqual([
      'total',
    ])
  })
})
