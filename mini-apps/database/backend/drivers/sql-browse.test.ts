import { describe, expect, test } from 'bun:test'
import { buildSqlBrowseQuery } from './sql-browse'

describe('structured SQL browse', () => {
  test('quotes schema and table and applies bounded pagination', () => {
    expect(
      buildSqlBrowseQuery('postgres', {
        schema: 'sales data',
        table: 'order',
        limit: 100,
        offset: 200,
      }),
    ).toBe('SELECT * FROM "sales data"."order" LIMIT 100 OFFSET 200;')
  })

  test('uses SQL Server OFFSET syntax and clamps unsafe page values', () => {
    expect(
      buildSqlBrowseQuery('mssql', {
        schema: 'dbo',
        table: 'users]',
        limit: 50_000,
        offset: -20,
      }),
    ).toBe(
      'SELECT * FROM [dbo].[users]]] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY;',
    )
  })

  test('quotes a server-side sort column instead of interpolating executable text', () => {
    expect(
      buildSqlBrowseQuery('postgres', {
        table: 'users',
        limit: 25,
        offset: 0,
        sort: { column: 'name"; DROP TABLE users; --', direction: 'desc' },
      }),
    ).toBe('SELECT * FROM "users" ORDER BY "name""; DROP TABLE users; --" DESC LIMIT 25 OFFSET 0;')
    expect(
      buildSqlBrowseQuery('mssql', {
        schema: 'dbo',
        table: 'users',
        limit: 25,
        offset: 50,
        sort: { column: 'created_at', direction: 'asc' },
      }),
    ).toBe(
      'SELECT * FROM [dbo].[users] ORDER BY [created_at] ASC OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;',
    )
  })
})
