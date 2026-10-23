import { expect, test } from 'bun:test'
import { pgTableSchema } from './postgres-introspect'
import type { RowsExecutor } from './fk-rows'

test('multiple parents require a default override but inherit NOT NULL from any parent', async () => {
  const rows: RowsExecutor = async <T>(sql: string) => {
    if (sql.includes('reltuples::bigint')) return [{ reltuples: '0', relkind: 'r' }] as T[]
    if (sql.includes('NOT child_attribute.attislocal')) {
      return [
        {
          column_name: 'mixed',
          child_default: ' 1 ',
          parent_default: '1',
          child_not_null: true,
          parent_not_null: false,
        },
        {
          column_name: 'mixed',
          child_default: ' 1 ',
          parent_default: '2',
          child_not_null: true,
          parent_not_null: true,
        },
        {
          column_name: 'empty',
          child_default: ' ',
          parent_default: null,
          child_not_null: false,
          parent_not_null: false,
        },
      ] as T[]
    }
    if (sql.includes('JOIN pg_catalog.pg_inherits inheritance') && sql.includes('NOT COALESCE')) {
      return [
        { parent_schema: 'public', parent_table: 'second' },
        { parent_schema: 'public', parent_table: 'first' },
      ] as T[]
    }
    return [] as T[]
  }
  const schema = await pgTableSchema(rows, 'public', 'child')
  expect(schema.postgresInheritance).toEqual({
    parents: [
      { schema: 'public', table: 'second' },
      { schema: 'public', table: 'first' },
    ],
    localColumns: [],
    defaultOverrides: [{ column: 'mixed', value: '1' }],
  })
})
