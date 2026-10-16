import { describe, expect, it } from 'bun:test'
import { extractSqlTableReferences, extractSqlTableRefs } from './sql-context'

describe('SQL context table references', () => {
  it('preserves schema qualification and de-duplicates case-insensitively', () => {
    expect(
      extractSqlTableReferences(
        'SELECT * FROM public.Users u JOIN orders o ON true; UPDATE PUBLIC.users SET x = 1',
      ),
    ).toEqual([{ schema: 'public', table: 'Users' }, { table: 'orders' }])
  })

  it('supports quoted identifiers across common SQL dialects', () => {
    expect(
      extractSqlTableReferences(
        'SELECT * FROM "sales data"."Order Items" JOIN [audit].[Event Log] ON 1 = 1',
      ),
    ).toEqual([
      { schema: 'sales data', table: 'Order Items' },
      { schema: 'audit', table: 'Event Log' },
    ])
  })

  it('offers bare lower-case names to the automatic provider matcher', () => {
    expect(extractSqlTableRefs('INSERT INTO public.Logs VALUES (1); DELETE FROM logs')).toEqual([
      'logs',
    ])
  })
})
