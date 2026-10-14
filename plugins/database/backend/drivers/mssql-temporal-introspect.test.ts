import { describe, expect, it } from 'bun:test'

import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'

describe('SQL Server temporal catalog semantics', () => {
  it('preserves generated period columns and the linked history table', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        expect(sql).toContain('FROM sys.columns col')
        expect(sql).toContain('LEFT JOIN INFORMATION_SCHEMA.COLUMNS info')
        expect(sql).toContain('col.generated_always_type_desc AS GENERATED_ALWAYS_TYPE')
        expect(sql).toContain('col.is_hidden AS IS_HIDDEN')
        return [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            DEFAULT_CONSTRAINT_NAME: null,
            COLLATION_NAME: null,
            IS_ROWGUID: false,
            IS_SPARSE: false,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
            GENERATED_ALWAYS_TYPE: 'NOT_APPLICABLE',
            IS_HIDDEN: false,
          },
          {
            COLUMN_NAME: 'valid_from',
            DATA_TYPE: 'datetime2',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: 7,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: '(sysutcdatetime())',
            DEFAULT_CONSTRAINT_NAME: 'DF_orders_valid_from',
            COLLATION_NAME: null,
            IS_ROWGUID: false,
            IS_SPARSE: false,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
            GENERATED_ALWAYS_TYPE: 'AS_ROW_START',
            IS_HIDDEN: true,
          },
          {
            COLUMN_NAME: 'valid_to',
            DATA_TYPE: 'datetime2',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: 7,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: "('9999-12-31 23:59:59.9999999')",
            DEFAULT_CONSTRAINT_NAME: 'DF_orders_valid_to',
            COLLATION_NAME: null,
            IS_ROWGUID: false,
            IS_SPARSE: false,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
            GENERATED_ALWAYS_TYPE: 'AS_ROW_END',
            IS_HIDDEN: false,
          },
        ] as T[]
      }
      if (sql.includes('idx.is_primary_key = 1')) return [{ COLUMN_NAME: 'id' }] as T[]
      if (
        sql.includes('FROM sys.foreign_keys') ||
        sql.includes('FROM sys.check_constraints') ||
        sql.includes('FROM sys.indexes') ||
        sql.includes('FROM sys.triggers') ||
        sql.includes('OBJECT_DEFINITION')
      )
        return [] as T[]

      expect(sql).toContain('LEFT JOIN sys.tables history_table')
      expect(sql).toContain('LEFT JOIN sys.periods period_info')
      expect(sql).toContain('period_info.start_column_id')
      expect(sql).toContain('period_info.end_column_id')
      return [
        {
          ROW_COUNT: 12,
          OBJECT_TYPE: 'U',
          TEMPORAL_TYPE: 2,
          HISTORY_SCHEMA: 'history',
          HISTORY_TABLE: 'orders_history',
          PERIOD_START: 'valid_from',
          PERIOD_END: 'valid_to',
        },
      ] as T[]
    }

    const schema = await mssqlTableSchema(rows, 'sales', 'orders')

    expect(schema.columns[1]).toMatchObject({
      name: 'valid_from',
      sqlServerGeneratedAlways: 'ROW START',
      sqlServerHidden: true,
    })
    expect(schema.columns[2]).toMatchObject({
      name: 'valid_to',
      sqlServerGeneratedAlways: 'ROW END',
    })
    expect(schema.columns[2]).not.toHaveProperty('sqlServerHidden')
    expect(schema.sqlServerTemporal).toEqual({
      periodStart: 'valid_from',
      periodEnd: 'valid_to',
      systemVersioned: true,
      historySchema: 'history',
      historyTable: 'orders_history',
    })
  })

  it('does not misrepresent ledger generated columns as an ordinary temporal table', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS'))
        return [
          {
            COLUMN_NAME: 'ledger_start_transaction_id',
            DATA_TYPE: 'bigint',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 19,
            NUMERIC_SCALE: 0,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            GENERATED_ALWAYS_TYPE: 'AS_TRANSACTION_ID_START',
            IS_HIDDEN: true,
          },
          {
            COLUMN_NAME: 'valid_from',
            DATA_TYPE: 'datetime2',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: 7,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            GENERATED_ALWAYS_TYPE: 'AS_ROW_START',
            IS_HIDDEN: true,
          },
        ] as T[]
      if (
        sql.includes('idx.is_primary_key = 1') ||
        sql.includes('FROM sys.foreign_keys') ||
        sql.includes('FROM sys.check_constraints') ||
        sql.includes('FROM sys.indexes') ||
        sql.includes('FROM sys.triggers') ||
        sql.includes('OBJECT_DEFINITION')
      )
        return [] as T[]
      return [
        {
          ROW_COUNT: 2,
          OBJECT_TYPE: 'U',
          TEMPORAL_TYPE: 2,
          HISTORY_SCHEMA: 'dbo',
          HISTORY_TABLE: 'ledger_history',
          PERIOD_START: 'valid_from',
          PERIOD_END: 'valid_to',
        },
      ] as T[]
    }

    const schema = await mssqlTableSchema(rows, 'dbo', 'ledger_entries')

    expect(schema.sqlServerTemporal).toBeUndefined()
    expect(schema.columns).not.toContainEqual(
      expect.objectContaining({ sqlServerGeneratedAlways: expect.any(String) }),
    )
  })
})
