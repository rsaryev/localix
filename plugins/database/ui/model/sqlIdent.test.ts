import { describe, expect, test } from 'bun:test'

import { quoteIdent, selectTableSql } from './sqlIdent'

/**
 * Behavior lock for SQL identifier quoting — an INJECTION-PREVENTION primitive. A table/column
 * name reaches a query string through quoteIdent; if the closing delimiter isn't doubled, a
 * crafted name breaks out of the quotes and the rest is executed as SQL. These pin the correct
 * escape per dialect and prove a breakout attempt stays contained, so a refactor can't quietly
 * weaken the defense.
 */
describe('quoteIdent — per-dialect delimiter + doubling escape', () => {
  test('mysql backtick-quotes and doubles an embedded backtick', () => {
    expect(quoteIdent('users', 'mysql')).toBe('`users`')
    expect(quoteIdent('a`b', 'mysql')).toBe('`a``b`')
  })

  test('mssql square-brackets and doubles an embedded closing bracket', () => {
    expect(quoteIdent('users', 'mssql')).toBe('[users]')
    expect(quoteIdent('a]b', 'mssql')).toBe('[a]]b]')
    expect(quoteIdent('a[b', 'mssql')).toBe('[a[b]') // only the CLOSING bracket needs escaping
  })

  test('postgres/sqlite double-quote and double an embedded double-quote', () => {
    expect(quoteIdent('users', 'postgres')).toBe('"users"')
    expect(quoteIdent('users', 'sqlite')).toBe('"users"')
    expect(quoteIdent('a"b', 'postgres')).toBe('"a""b"')
  })

  test('a breakout attempt stays fully contained inside the quotes', () => {
    // The `"` is doubled, so the whole payload remains a single (weird) identifier — not SQL.
    expect(quoteIdent('x"; DROP TABLE users; --', 'postgres')).toBe('"x""; DROP TABLE users; --"')
    expect(quoteIdent('x`; DROP TABLE users; --', 'mysql')).toBe('`x``; DROP TABLE users; --`')
    expect(quoteIdent('x]; DROP TABLE users; --', 'mssql')).toBe('[x]]; DROP TABLE users; --]')
  })
})

describe('selectTableSql (unqualified) — dialect row-limit syntax over a quoted table', () => {
  test('LIMIT dialects quote the table and append LIMIT', () => {
    expect(selectTableSql({ table: 'orders', dialect: 'postgres' })).toBe(
      'SELECT * FROM "orders" LIMIT 200;',
    )
    expect(selectTableSql({ table: 'orders', dialect: 'mysql' }, 50)).toBe(
      'SELECT * FROM `orders` LIMIT 50;',
    )
  })

  test('SQL Server uses TOP instead of LIMIT', () => {
    expect(selectTableSql({ table: 'orders', dialect: 'mssql' }, 25)).toBe(
      'SELECT TOP 25 * FROM [orders];',
    )
  })

  test('the table name is quoted here too (no raw interpolation)', () => {
    expect(selectTableSql({ table: 'a"b', dialect: 'postgres' }, 10)).toBe(
      'SELECT * FROM "a""b" LIMIT 10;',
    )
  })

  test('qualifies a table when Explorer provides its schema', () => {
    expect(selectTableSql({ table: 'orders', schema: 'sales', dialect: 'postgres' }, 25)).toBe(
      'SELECT * FROM "sales"."orders" LIMIT 25;',
    )
  })
})
