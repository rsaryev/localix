import { describe, expect, it } from 'bun:test'

import { buildIndexStatements } from '../ddl'
import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'

describe('SQL Server filtered index catalog semantics', () => {
  it('preserves the filter beside ordered keys and included columns', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS'))
        return [
          {
            COLUMN_NAME: 'email',
            DATA_TYPE: 'nvarchar',
            CHARACTER_MAXIMUM_LENGTH: 320,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
          },
        ] as T[]
      if (
        sql.includes('idx.is_primary_key = 1') ||
        sql.includes('FROM sys.foreign_keys') ||
        sql.includes('FROM sys.check_constraints') ||
        sql.includes('OBJECT_DEFINITION')
      )
        return [] as T[]
      if (sql.includes('FROM sys.indexes')) {
        expect(sql).toContain('i.filter_definition AS FILTER_DEFINITION')
        expect(sql).not.toContain('i.has_filter = 0')
        return [
          {
            INDEX_NAME: 'users_active_email_idx',
            COLUMN_NAME: 'email',
            KEY_ORDINAL: 1,
            IS_UNIQUE: true,
            IS_PRIMARY: false,
            IS_CONSTRAINT: false,
            IS_INCLUDED: false,
            IS_DESCENDING: true,
            INDEX_COLUMN_ID: 1,
            INDEX_TYPE: 2,
            FILTER_DEFINITION: '([deleted_at] IS NULL)',
          },
          {
            INDEX_NAME: 'users_active_email_idx',
            COLUMN_NAME: 'display_name',
            KEY_ORDINAL: 0,
            IS_UNIQUE: true,
            IS_PRIMARY: false,
            IS_CONSTRAINT: false,
            IS_INCLUDED: true,
            IS_DESCENDING: false,
            INDEX_COLUMN_ID: 2,
            INDEX_TYPE: 2,
            FILTER_DEFINITION: '([deleted_at] IS NULL)',
          },
        ] as T[]
      }
      return [{ ROW_COUNT: 9, OBJECT_TYPE: 'U' }] as T[]
    }

    const schema = await mssqlTableSchema(rows, 'sales', 'users')

    expect(schema.indexes).toEqual([
      {
        name: 'users_active_email_idx',
        columns: ['email'],
        includeColumns: ['display_name'],
        unique: true,
        primary: false,
        orders: ['desc'],
        predicate: '([deleted_at] IS NULL)',
      },
    ])
    expect(buildIndexStatements(schema, 'mssql')).toEqual([
      'CREATE UNIQUE INDEX [users_active_email_idx] ON [sales].[users] ([email] DESC) ' +
        'INCLUDE ([display_name]) WHERE ([deleted_at] IS NULL);',
    ])
  })
})
