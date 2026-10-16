import { expect, test } from 'bun:test'
import { pgTableSchema } from './postgres-introspect'
import type { RowsExecutor } from './fk-rows'
import type { PgColumnRow } from './postgres-catalog-rows'

test('column recovery preserves a zero statistics target and omits unsupported metadata', async () => {
  const columns: PgColumnRow[] = [
    {
      column_name: 'zero',
      data_type: 'integer',
      is_nullable: 'YES',
      column_default: null,
      statistics_target: 0,
      storage_kind: 'unknown',
      compression_method: 'unknown',
      generated_kind: 's',
      generated_expression: '',
    },
    {
      column_name: 'missing',
      data_type: 'text',
      is_nullable: 'NO',
      column_default: "''::text",
      statistics_target: null,
    },
    {
      column_name: 'invalid',
      data_type: 'integer',
      is_nullable: 'YES',
      column_default: '0',
      statistics_target: 'not-a-number',
    },
  ]
  const rows: RowsExecutor = async <T>(sql: string) =>
    (sql.includes('compression_method, statistics_target, attribute_options') ? columns : []) as T[]
  const result = await pgTableSchema(rows, 'public', 'items')
  expect(result.columns).toEqual([
    {
      name: 'zero',
      dataType: 'integer',
      nullable: true,
      pk: false,
      defaultValue: null,
      postgresStatistics: 0,
    },
    { name: 'missing', dataType: 'text', nullable: false, pk: false, defaultValue: "''::text" },
    { name: 'invalid', dataType: 'integer', nullable: true, pk: false, defaultValue: '0' },
  ])
})
