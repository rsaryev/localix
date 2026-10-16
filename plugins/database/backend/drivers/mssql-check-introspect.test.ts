import { describe, expect, it } from 'bun:test'

import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'

describe('SQL Server CHECK constraint catalog semantics', () => {
  it('preserves expression, replication, disabled, and trust state', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS'))
        return [
          {
            COLUMN_NAME: 'quantity',
            DATA_TYPE: 'int',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
          },
        ] as T[]
      if (sql.includes('idx.is_primary_key = 1')) return [] as T[]
      if (sql.includes('FROM sys.foreign_keys')) return [] as T[]
      if (sql.includes('FROM sys.check_constraints')) {
        expect(sql).toContain('checks.definition AS EXPRESSION')
        expect(sql).toContain('checks.is_not_for_replication AS NOT_FOR_REPLICATION')
        expect(sql).toContain('checks.is_disabled AS IS_DISABLED')
        expect(sql).toContain('checks.is_not_trusted AS IS_NOT_TRUSTED')
        expect(sql).toContain('JOIN sys.tables')
        expect(sql).toContain('JOIN sys.schemas')
        return [
          {
            CONSTRAINT_NAME: 'CK_orders_quantity',
            EXPRESSION: '([quantity]>(0))',
            NOT_FOR_REPLICATION: true,
            IS_DISABLED: true,
            IS_NOT_TRUSTED: true,
          },
        ] as T[]
      }
      if (sql.includes('FROM sys.indexes')) return [] as T[]
      if (sql.includes('OBJECT_DEFINITION')) return [] as T[]
      return [{ ROW_COUNT: 4, OBJECT_TYPE: 'U' }] as T[]
    }

    expect((await mssqlTableSchema(rows, 'sales', 'orders')).checkConstraints).toEqual([
      {
        name: 'CK_orders_quantity',
        expression: '([quantity]>(0))',
        notForReplication: true,
        disabled: true,
        notTrusted: true,
      },
    ])
  })
})
