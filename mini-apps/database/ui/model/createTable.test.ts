import { describe, expect, it } from 'bun:test'
import { buildCreateTableSql } from './createTable'

describe('buildCreateTableSql', () => {
  it('quotes a qualified Postgres table and emits a composite primary key', () => {
    expect(
      buildCreateTableSql('postgres', {
        schema: 'sales data',
        table: 'order',
        columns: [
          { name: 'tenant_id', dataType: 'uuid', nullable: false, primaryKey: true },
          { name: 'order_id', dataType: 'bigint', nullable: false, primaryKey: true },
          { name: 'note', dataType: 'text', nullable: true, primaryKey: false },
        ],
      }),
    ).toBe(
      'CREATE TABLE "sales data"."order" (\n' +
        '  "tenant_id" uuid NOT NULL,\n' +
        '  "order_id" bigint NOT NULL,\n' +
        '  "note" text,\n' +
        '  PRIMARY KEY ("tenant_id", "order_id")\n' +
        ');',
    )
  })

  it('contains identifier breakout attempts and validates an empty draft', () => {
    const sql = buildCreateTableSql('mysql', {
      table: 'x`; DROP TABLE users; --',
      columns: [{ name: 'id', dataType: 'BIGINT', nullable: false, primaryKey: true }],
    })
    expect(sql).toContain('`x``; DROP TABLE users; --`')
    expect(() => buildCreateTableSql('sqlite', { table: '', columns: [] })).toThrow()
  })
})
