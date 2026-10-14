import { describe, expect, it } from 'bun:test'
import { csvToInserts } from './csvImport'
import type { MutationTarget } from './rowMutations'

const sqlite: MutationTarget = { table: 'users', dialect: 'sqlite', pk: ['id'] }

describe('csvToInserts', () => {
  it('generates one INSERT per data row, typing numbers and NULLs', () => {
    const csv = 'id,name,age\n1,Ann,30\n2,Bob,\n'
    const out = csvToInserts(csv, sqlite)
    expect(out.rowCount).toBe(2)
    expect(out.columns).toEqual(['id', 'name', 'age'])
    expect(out.sql).toBe(
      'INSERT INTO "users" ("id", "name", "age") VALUES (1, \'Ann\', 30);\n' +
        'INSERT INTO "users" ("id", "name", "age") VALUES (2, \'Bob\', NULL);',
    )
  })

  it('keeps leading-zero ids as strings', () => {
    const out = csvToInserts('id\n007', sqlite)
    expect(out.sql).toBe('INSERT INTO "users" ("id") VALUES (\'007\');')
  })

  it('imports prototype-named physical columns instead of dropping them from the record', () => {
    const out = csvToInserts('__proto__,constructor,prototype\nvalue,ctor,proto\n', sqlite)
    expect(out.sql).toBe(
      'INSERT INTO "users" ("__proto__", "constructor", "prototype") ' +
        "VALUES ('value', 'ctor', 'proto');",
    )
  })

  it('preserves integers and decimals that exceed JavaScript number precision', () => {
    const out = csvToInserts('id,amount\n9007199254740993,12345678901234567890.123456789\n', sqlite)
    expect(out.sql).toBe(
      'INSERT INTO "users" ("id", "amount") VALUES (9007199254740993, ' +
        "'12345678901234567890.123456789');",
    )
  })

  it('returns empty for a header-only or blank CSV', () => {
    expect(csvToInserts('id,name\n', sqlite).rowCount).toBe(0)
    expect(csvToInserts('', sqlite).sql).toBe('')
  })

  it('preserves an embedded newline inside a quoted field (one row, not two)', () => {
    // A newline inside quotes is part of the field — parseDelimited must not treat it as a
    // row boundary, and it must survive into the SQL literal (engines accept a literal
    // newline in a quoted string). Verified live against Postgres too.
    const out = csvToInserts('id,note\n1,"line1\nline2"\n', sqlite)
    expect(out.rowCount).toBe(1)
    expect(out.sql).toBe('INSERT INTO "users" ("id", "note") VALUES (1, \'line1\nline2\');')
  })

  it('parses quoted commas + doubled-quote escapes and stays injection-safe', () => {
    // "a,b" → literal comma inside the field; "say ""hi""" → say "hi"; the last row is a
    // SQL-injection attempt that must be neutralized into a single quoted literal.
    const csv = 'id,label\n1,"a,b"\n2,"say ""hi"""\n3,"\'); DROP TABLE users; --"\n'
    const out = csvToInserts(csv, sqlite)
    expect(out.rowCount).toBe(3)
    expect(out.sql).toBe(
      'INSERT INTO "users" ("id", "label") VALUES (1, \'a,b\');\n' +
        'INSERT INTO "users" ("id", "label") VALUES (2, \'say "hi"\');\n' +
        'INSERT INTO "users" ("id", "label") VALUES (3, \'\'\'); DROP TABLE users; --\');',
    )
  })

  it('rejects headers that would silently discard or overwrite cells', () => {
    expect(() => csvToInserts('id,,name\n1,ignored,Ann', sqlite)).toThrow(
      'CSV header column 2 has no name.',
    )
    expect(() => csvToInserts('id,name,id\n1,Ann,2', sqlite)).toThrow(
      'CSV header contains the duplicate column "id".',
    )
  })

  it('rejects extra values and unclosed quoted fields instead of truncating them', () => {
    expect(() => csvToInserts('id,name\n1,Ann,ignored', sqlite)).toThrow(
      'CSV data row 1 has 3 values for 2 columns.',
    )
    expect(() => csvToInserts('id,note\n1,"never closes', sqlite)).toThrow(
      'CSV contains an unclosed quoted field.',
    )
  })
})
