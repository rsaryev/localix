import { describe, expect, test } from 'bun:test'

import { bindMssqlParams, buildMssqlPoolConfig } from './mssql'
import { compileSql } from '../../ui/model/sqlParams'

describe('MSSQL parameter binding', () => {
  test('rewrites code-level ? to namespaced parameters in order', () => {
    expect(bindMssqlParams('SELECT * FROM t WHERE a = ? AND b = ?', ['x', 2])).toEqual({
      text: 'SELECT * FROM t WHERE a = @__localix_p0 AND b = @__localix_p1',
      names: ['__localix_p0', '__localix_p1'],
    })
  })

  test('never binds a ? inside a literal, bracket identifier or comment', () => {
    // The regression. `text.replace(/\?/g, …)` bound the `?` in `'why?'`, so the VALUE
    // landed inside the string and the real placeholder got params[1] — undefined. No
    // error was raised; the query silently matched `note = 'why<value>'`.
    const bound = bindMssqlParams(`SELECT * FROM t WHERE note = 'why?' AND id = ?`, [100])
    expect(bound.text).toBe(`SELECT * FROM t WHERE note = 'why?' AND id = @__localix_p0`)
    expect(bound.names).toEqual(['__localix_p0'])

    expect(bindMssqlParams(`SELECT [a?b] FROM t -- ?\nWHERE id = ? /* ? */`, [7]).text).toBe(
      `SELECT [a?b] FROM t -- ?\nWHERE id = @__localix_p0 /* ? */`,
    )
  })

  test('does not collide with node-mssql reserved or user-authored @pN variables', () => {
    expect(bindMssqlParams('DECLARE @p0 int = 7; SELECT @p0, ?', [9])).toEqual({
      text: 'DECLARE @p0 int = 7; SELECT @p0, @__localix_p0',
      names: ['__localix_p0'],
    })
  })

  test('T-SQL escapes quotes by DOUBLING, and a backslash is a literal character', () => {
    // MSSQL is not MySQL/ClickHouse: `\` does not escape. `'a\'` is a complete literal
    // holding `a\`, so the `?` after it is real code. Treating `\` as an escape here
    // would run past the closing quote and hide that placeholder.
    expect(bindMssqlParams(`SELECT * FROM t WHERE p = 'a\\' AND id = ?`, [1]).text).toBe(
      `SELECT * FROM t WHERE p = 'a\\' AND id = @__localix_p0`,
    )
    // Doubled quotes keep the literal open, so the `?` between them stays data.
    expect(bindMssqlParams(`SELECT 'it''s ?' AS q, ? AS p`, [5]).text).toBe(
      `SELECT 'it''s ?' AS q, @__localix_p0 AS p`,
    )
    // `]]` doubling inside a bracket identifier behaves the same way.
    expect(bindMssqlParams(`SELECT [we]]ird ?] FROM t WHERE id = ?`, [9]).text).toBe(
      `SELECT [we]]ird ?] FROM t WHERE id = @__localix_p0`,
    )
  })

  test('no params leaves the SQL untouched, even with question marks in it', () => {
    expect(bindMssqlParams(`SELECT 'why?' FROM t`, [])).toEqual({
      text: `SELECT 'why?' FROM t`,
      names: [],
    })
  })

  test('fails closed when the placeholder and value counts disagree', () => {
    expect(() => bindMssqlParams('SELECT ?', [1, 2])).toThrow(/more values than placeholders/)
    expect(() => bindMssqlParams('SELECT ? + ?', [1])).toThrow(/more placeholders than values/)
    // Previously this class of mismatch was invisible: an in-literal `?` absorbed a value
    // and the count still "matched".
    expect(() => bindMssqlParams(`SELECT 'why?' , ?`, [1, 2])).toThrow()
  })

  test('agrees with the console scanner that produced the placeholders', () => {
    // End-to-end: what the UI compiles is what the driver binds. A disagreement here is
    // the cross-layer bug class, so pin the two together rather than each alone.
    const raw = `SELECT * FROM t WHERE note = 'why?' AND id = :id AND b = @x`
    const compiled = compileSql(raw, 'mssql', { 'n:id': 100, 'n:x': 7 })
    const bound = bindMssqlParams(compiled.text, compiled.params)
    expect(compiled.params).toEqual([100, 7])
    expect(bound.names).toEqual(['__localix_p0', '__localix_p1'])
    expect(bound.text).toBe(
      `SELECT * FROM t WHERE note = 'why?' AND id = @__localix_p0 AND b = @__localix_p1`,
    )
  })
})

describe('MSSQL TLS config', () => {
  test('parses a URI with the surrounding whitespace accepted by the public contract', () => {
    expect(
      buildMssqlPoolConfig({
        url: ' \n mssql://reader:secret@sql.example:1433/app?encrypt=true \t',
      }),
    ).toMatchObject({
      server: 'sql.example',
      port: 1433,
      user: 'reader',
      password: 'secret',
      database: 'app',
      options: { encrypt: true },
    })
  })

  test('maps separate PEM values beside a URI into tedious secure-context options', () => {
    expect(
      buildMssqlPoolConfig({
        url: 'mssql://reader:secret@sql.example/app',
        ssl: {
          ca: 'CA PEM',
          cert: 'CERT PEM',
          key: 'KEY PEM',
          rejectUnauthorized: false,
        },
      }),
    ).toMatchObject({
      server: 'sql.example',
      options: {
        encrypt: true,
        trustServerCertificate: true,
        cryptoCredentialsDetails: {
          ca: 'CA PEM',
          cert: 'CERT PEM',
          key: 'KEY PEM',
        },
      },
    })
  })

  test('merges a separate TLS override into an ADO connection string', () => {
    expect(
      buildMssqlPoolConfig({
        url: 'Server=sql.example,1433;Database=app;User Id=reader;Password=secret',
        ssl: { ca: 'CA PEM' },
      }),
    ).toMatchObject({
      server: 'sql.example',
      database: 'app',
      user: 'reader',
      options: {
        encrypt: true,
        cryptoCredentialsDetails: { ca: 'CA PEM' },
      },
    })
  })
})
