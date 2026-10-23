import { describe, expect, it } from 'bun:test'
import type { TableColumn, TableRow } from '@localixai/dataview'
import { adaptResult } from './resultAdapter'
import { rowToInsert } from './rowCopy'
import type { MutationTarget } from './rowMutations'

const columns: TableColumn[] = [
  { id: 'c0', title: 'id', type: 'int' },
  { id: 'c1', title: 'name', type: 'text' },
  { id: 'c2', title: 'active', type: 'bool' },
]

describe('rowToInsert', () => {
  const sqlite: MutationTarget = { table: 'users', dialect: 'sqlite', pk: ['id'] }

  it('builds one INSERT addressing columns by title, escaping strings', () => {
    const row: TableRow = { c0: 1, c1: "O'Brien", c2: true }
    expect(rowToInsert(sqlite, columns, row)).toBe(
      'INSERT INTO "users" ("id", "name", "active") VALUES (1, \'O\'\'Brien\', 1);',
    )
  })

  it('emits NULL for a missing cell', () => {
    const row: TableRow = { c0: 2 }
    expect(rowToInsert(sqlite, columns, row)).toBe(
      'INSERT INTO "users" ("id", "name", "active") VALUES (2, NULL, NULL);',
    )
  })

  it('honors the target dialect (postgres schema-qualified, TRUE/FALSE booleans)', () => {
    const pg: MutationTarget = { table: 'users', schema: 'public', dialect: 'postgres', pk: ['id'] }
    const row: TableRow = { c0: 3, c1: 'Zoe', c2: false }
    expect(rowToInsert(pg, columns, row)).toBe(
      'INSERT INTO "public"."users" ("id", "name", "active") VALUES (3, \'Zoe\', FALSE);',
    )
  })

  it('copies the exact BLOB behind the compact grid marker', () => {
    const result = adaptResult({
      columns: [{ name: 'id' }, { name: 'name' }, { name: 'active' }],
      rows: [[1, { type: 'Buffer', data: [0x00, 0xff] }, true]],
      durationMs: 0,
    })
    expect(rowToInsert(sqlite, result.columns, result.rows[0]!, result)).toBe(
      `INSERT INTO "users" ("id", "name", "active") VALUES (1, X'00ff', 1);`,
    )
  })
})
