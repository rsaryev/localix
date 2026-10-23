import { describe, expect, it } from 'bun:test'
import {
  buildBoundDelete,
  buildBoundInsert,
  buildBoundUpdate,
  buildInsert,
  buildInsertsFromRows,
  coerceMutationCell,
  qualifiedTable,
  type MutationTarget,
} from './rowMutations'
import { sqlLiteral } from './sqlLiteral'

const pg: MutationTarget = { table: 'users', schema: 'public', dialect: 'postgres', pk: ['id'] }
const sqlite: MutationTarget = { table: 'users', dialect: 'sqlite', pk: ['id'] }

describe('sqlLiteral', () => {
  it('renders primitives per dialect', () => {
    expect(sqlLiteral(null, 'sqlite')).toBe('NULL')
    expect(sqlLiteral(42, 'sqlite')).toBe('42')
    expect(sqlLiteral(true, 'postgres')).toBe('TRUE')
    expect(sqlLiteral(true, 'mysql')).toBe('1')
    expect(sqlLiteral("O'Brien", 'sqlite')).toBe("'O''Brien'")
  })

  it('renders backslashes with mode-independent dialect syntax', () => {
    expect(sqlLiteral('a\\b', 'mysql')).toBe("_utf8mb4 X'615c62'")
    expect(sqlLiteral('a\\b', 'postgres')).toBe("E'a\\\\b'")
    expect(sqlLiteral('a\\b', 'clickhouse')).toBe("'a\\\\b'")
  })
})

describe('row mutations', () => {
  it('qualifies the table with its schema, quoted per dialect', () => {
    expect(qualifiedTable(pg)).toBe('"public"."users"')
    expect(qualifiedTable(sqlite)).toBe('"users"')
    // No `pk` here: qualifiedTable names a TABLE and never read it — the narrowed
    // parameter is what lets a caller that has no mutation target (an FK link) reach it.
    expect(qualifiedTable({ table: 't', dialect: 'mysql' })).toBe('`t`')
    expect(qualifiedTable({ table: 't', dialect: 'mssql' })).toBe('[t]')
  })

  it('qualifies a table in ANOTHER schema — the FK-link case', () => {
    // A bare name resolves against the search_path: either "relation does not exist", or —
    // worse — a same-named table elsewhere on it, which browses the WRONG row silently.
    // The FK map used to drop `refSchema` entirely, so this could not even be expressed.
    expect(qualifiedTable({ table: 'orgs', schema: 'tenant', dialect: 'postgres' })).toBe(
      '"tenant"."orgs"',
    )
  })

  it('omits the qualifier when there is no schema — the reverse direction', () => {
    // Single-schema engines (sqlite) pass no schema; emitting `"".` or `"main".` would
    // break every statement this module generates.
    expect(qualifiedTable({ table: 'orgs', dialect: 'sqlite' })).toBe('"orgs"')
  })

  it('builds an INSERT, omitting undefined values', () => {
    const sql = buildInsert(sqlite, { id: 1, name: 'Zoe', note: undefined })
    expect(sql).toBe('INSERT INTO "users" ("id", "name") VALUES (1, \'Zoe\');')
  })

  it('refuses to update/delete without a primary key', () => {
    const t: MutationTarget = { table: 'x', dialect: 'sqlite', pk: [] }
    expect(() => buildBoundUpdate(t, { a: 1 }, {})).toThrow()
    expect(() => buildBoundDelete(t, {})).toThrow()
  })

  it('addresses a null key value with IS NULL, not `= NULL` (would match nothing)', () => {
    // `col = NULL` is always false; the row must still be addressable when a key value is null.
    expect(buildBoundDelete(sqlite, { id: null })).toEqual({
      sql: 'DELETE FROM "users" WHERE "id" IS NULL;',
      params: [],
    })
    expect(buildBoundUpdate(sqlite, { name: 'x' }, { id: null })).toEqual({
      sql: 'UPDATE "users" SET "name" = ? WHERE "id" IS NULL;',
      params: ['x'],
    })
  })

  it('builds executable mutations with values kept in driver parameters', () => {
    expect(buildBoundUpdate(pg, { name: "Ada's", active: true }, { id: 7 })).toEqual({
      sql: 'UPDATE "public"."users" SET "name" = $1, "active" = $2 WHERE "id" = $3;',
      params: ["Ada's", true, 7],
    })
    expect(buildBoundInsert(sqlite, { id: 1, name: "O'Brien", note: undefined })).toEqual({
      sql: 'INSERT INTO "users" ("id", "name") VALUES (?, ?);',
      params: [1, "O'Brien"],
    })
    expect(buildBoundDelete({ ...sqlite, pk: ['id', 'tenant'] }, { id: 3, tenant: null })).toEqual({
      sql: 'DELETE FROM "users" WHERE "id" = ? AND "tenant" IS NULL;',
      params: [3],
    })
  })

  it('does not read a missing prototype-named primary key from Object.prototype', () => {
    expect(
      buildBoundDelete({ table: 'items', dialect: 'sqlite', pk: ['constructor'] }, {}),
    ).toEqual({
      sql: 'DELETE FROM "items" WHERE "constructor" IS NULL;',
      params: [],
    })
  })

  it('builds an all-default INSERT instead of silently dropping an empty new row', () => {
    expect(buildBoundInsert(sqlite, {})).toEqual({
      sql: 'INSERT INTO "users" DEFAULT VALUES;',
      params: [],
    })
    expect(buildBoundInsert({ ...sqlite, dialect: 'mysql' }, {})).toEqual({
      sql: 'INSERT INTO `users` () VALUES ();',
      params: [],
    })
    expect(buildBoundInsert({ ...sqlite, dialect: 'mssql' }, {})).toEqual({
      sql: 'INSERT INTO [users] DEFAULT VALUES;',
      params: [],
    })
  })
})

describe('database cell coercion', () => {
  it('keeps empty text distinct from explicit NULL', () => {
    expect(coerceMutationCell('', 'text')).toBe('')
    expect(coerceMutationCell('  ', 'text')).toBe('  ')
  })

  it('preserves integers outside the exact Number range for parameter binding', () => {
    expect(coerceMutationCell('42', 'int')).toBe(42)
    expect(coerceMutationCell('9007199254740993', 'int')).toBe('9007199254740993')
    expect(coerceMutationCell('-9007199254740993', 'int')).toBe('-9007199254740993')
  })

  it('rejects invalid typed input instead of silently converting it to NULL', () => {
    expect(() => coerceMutationCell('', 'int')).toThrow(/blank/)
    expect(() => coerceMutationCell('1.5', 'int')).toThrow(/integer/)
    expect(() => coerceMutationCell('maybe', 'bool')).toThrow(/bool/)
    expect(() => coerceMutationCell('1e999', 'float')).toThrow(/float/)
  })
})

describe('buildInsertsFromRows', () => {
  const columns = [
    { id: 'c0', title: 'id' },
    { id: 'c1', title: 'name' },
  ]

  it('emits one INSERT per row, addressing columns by title, NULL for missing cells', () => {
    const out = buildInsertsFromRows(sqlite, columns, [
      { c0: 1, c1: 'Ann' },
      { c0: 2 }, // name missing → NULL
    ])
    expect(out).toBe(
      'INSERT INTO "users" ("id", "name") VALUES (1, \'Ann\');\n' +
        'INSERT INTO "users" ("id", "name") VALUES (2, NULL);',
    )
  })

  it('returns empty string for no rows', () => {
    expect(buildInsertsFromRows(sqlite, columns, [])).toBe('')
  })

  it('uses physical provenance and omits computed columns from inferred results', () => {
    const target = {
      ...sqlite,
      sourceColumnById: { user_id: 'id', display: 'name' },
      editableColumnIds: new Set(['user_id', 'display']),
    }
    expect(
      buildInsertsFromRows(
        target,
        [
          { id: 'user_id', title: 'uid' },
          { id: 'display', title: 'display_name' },
          { id: 'total', title: 'COUNT(*)' },
        ],
        [{ user_id: 7, display: 'Ann', total: 99 }],
      ),
    ).toBe('INSERT INTO "users" ("id", "name") VALUES (7, \'Ann\');')
  })

  it('does not treat an inherited prototype member as physical provenance', () => {
    expect(
      buildInsertsFromRows(
        { ...sqlite, sourceColumnById: { user_id: 'id' } },
        [
          { id: 'user_id', title: 'uid' },
          { id: 'constructor', title: 'computed' },
        ],
        [{ user_id: 7, constructor: 99 }],
      ),
    ).toBe('INSERT INTO "users" ("id") VALUES (7);')
  })

  it('exports a prototype-named physical column as data', () => {
    expect(
      buildInsertsFromRows(
        sqlite,
        [
          { id: 'c0', title: '__proto__' },
          { id: 'c1', title: 'constructor' },
        ],
        [{ c0: 'proto value', c1: 'ctor value' }],
      ),
    ).toBe(
      'INSERT INTO "users" ("__proto__", "constructor") VALUES (\'proto value\', \'ctor value\');',
    )
  })
})
