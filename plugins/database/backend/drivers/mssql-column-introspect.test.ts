import { describe, expect, it } from 'bun:test'

import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'

describe('SQL Server column catalog semantics', () => {
  it('preserves computed, identity, default, collation, rowguid, and sparse attributes', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        expect(sql).toContain('LEFT JOIN sys.default_constraints')
        expect(sql).toContain('LEFT JOIN sys.computed_columns')
        expect(sql).toContain('LEFT JOIN sys.identity_columns')
        expect(sql).toContain('identity_col.seed_value')
        expect(sql).toContain('identity_col.increment_value')
        return [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'bigint',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 19,
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
            IDENTITY_SEED: '100',
            IDENTITY_INCREMENT: '10',
            IDENTITY_NOT_FOR_REPLICATION: true,
          },
          {
            COLUMN_NAME: 'row_id',
            DATA_TYPE: 'uniqueidentifier',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: '(newsequentialid())',
            DEFAULT_CONSTRAINT_NAME: 'DF_orders_row_id',
            COLLATION_NAME: null,
            IS_ROWGUID: true,
            IS_SPARSE: false,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
          },
          {
            COLUMN_NAME: 'nickname',
            DATA_TYPE: 'nvarchar',
            CHARACTER_MAXIMUM_LENGTH: 100,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            DEFAULT_CONSTRAINT_NAME: null,
            COLLATION_NAME: 'Latin1_General_100_CI_AS_SC',
            IS_ROWGUID: false,
            IS_SPARSE: true,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
          },
          {
            COLUMN_NAME: 'sparse_values',
            DATA_TYPE: 'xml',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            DEFAULT_CONSTRAINT_NAME: null,
            COLLATION_NAME: null,
            IS_ROWGUID: false,
            IS_SPARSE: false,
            IS_COLUMN_SET: true,
            COMPUTED_DEFINITION: null,
            IS_PERSISTED: null,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
          },
          {
            COLUMN_NAME: 'total',
            DATA_TYPE: 'decimal',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 18,
            NUMERIC_SCALE: 2,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            DEFAULT_CONSTRAINT_NAME: null,
            COLLATION_NAME: null,
            IS_ROWGUID: false,
            IS_SPARSE: false,
            IS_COLUMN_SET: false,
            COMPUTED_DEFINITION: '([quantity]*[unit_price])',
            IS_PERSISTED: true,
            IDENTITY_SEED: null,
            IDENTITY_INCREMENT: null,
            IDENTITY_NOT_FOR_REPLICATION: null,
          },
        ] as T[]
      }
      if (sql.includes('idx.is_primary_key = 1')) return [{ COLUMN_NAME: 'id' }] as T[]
      if (sql.includes('FROM sys.foreign_keys')) return [] as T[]
      if (sql.includes('FROM sys.check_constraints')) return [] as T[]
      if (sql.includes('FROM sys.indexes')) return [] as T[]
      if (sql.includes('OBJECT_DEFINITION')) return [] as T[]
      return [{ ROW_COUNT: 8, OBJECT_TYPE: 'U' }] as T[]
    }

    const schema = await mssqlTableSchema(rows, 'sales', 'orders')

    expect(schema.columns).toEqual([
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        pk: true,
        defaultValue: null,
        sqlServerIdentity: {
          seed: '100',
          increment: '10',
          notForReplication: true,
        },
      },
      {
        name: 'row_id',
        dataType: 'uniqueidentifier',
        nullable: false,
        pk: false,
        defaultValue: '(newsequentialid())',
        defaultConstraintName: 'DF_orders_row_id',
        rowGuid: true,
      },
      {
        name: 'nickname',
        dataType: 'nvarchar(100)',
        nullable: true,
        pk: false,
        defaultValue: null,
        collation: 'Latin1_General_100_CI_AS_SC',
        sparse: true,
      },
      {
        name: 'sparse_values',
        dataType: 'xml',
        nullable: true,
        pk: false,
        defaultValue: null,
        columnSet: true,
      },
      {
        name: 'total',
        dataType: 'decimal(18,2)',
        nullable: false,
        pk: false,
        defaultValue: null,
        sqlServerComputed: {
          expression: '([quantity]*[unit_price])',
          persisted: true,
        },
      },
    ])
  })
})
