import { describe, expect, test } from 'bun:test'
import { groupCatalogRows, readColumnCatalog } from './column-catalog'

const row = (table_schema: string, table_name: string, column_name: string, is_pk: unknown) => ({
  table_schema,
  table_name,
  column_name,
  data_type: 'int',
  is_pk: is_pk as boolean,
})

describe('column catalog', () => {
  test('groups ordered rows per (schema, table), keeping equal names in other schemas apart', () => {
    const catalog = groupCatalogRows([
      row('audit', 'users', 'at', false),
      row('public', 'users', 'id', true),
      row('public', 'users', 'email', false),
    ])
    expect(catalog.map((t) => [t.schema, t.table, t.columns.map((c) => c.name)])).toEqual([
      ['audit', 'users', ['at']],
      ['public', 'users', ['id', 'email']],
    ])
  })

  test('reads primary-key flags in every engine spelling', () => {
    const [table] = groupCatalogRows([
      row('s', 't', 'a', true),
      row('s', 't', 'b', 1),
      row('s', 't', 'c', '1'),
      row('s', 't', 'd', 0),
      row('s', 't', 'e', null),
    ])
    expect(table!.columns.map((c) => c.pk)).toEqual([true, true, true, false, false])
  })

  test('is one query, whatever the table count', async () => {
    let queries = 0
    const rows = async <T>() => {
      queries += 1
      return Array.from({ length: 300 }, (_, i) => row('s', `t${i}`, 'id', true)) as T[]
    }
    const catalog = await readColumnCatalog(rows, 'SELECT ...')
    expect(catalog).toHaveLength(300)
    expect(queries).toBe(1)
  })
})
