import { describe, expect, it } from 'bun:test'

import { describeColumnGeneration, reconstructCreate } from '../ddl'
import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'

describe('SQL Server Dynamic Data Masking catalog semantics', () => {
  it('preserves a column masking function in DDL and model-facing metadata', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        expect(sql).toContain('LEFT JOIN sys.masked_columns masked')
        expect(sql).toContain('masked.masking_function AS MASKING_FUNCTION')
        return [
          {
            COLUMN_NAME: 'email',
            DATA_TYPE: 'nvarchar',
            CHARACTER_MAXIMUM_LENGTH: 100,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            MASKING_FUNCTION: 'email()',
          },
        ] as T[]
      }
      if (
        sql.includes('idx.is_primary_key = 1') ||
        sql.includes('FROM sys.foreign_keys') ||
        sql.includes('FROM sys.check_constraints') ||
        sql.includes('FROM sys.indexes') ||
        sql.includes('OBJECT_DEFINITION')
      )
        return [] as T[]
      return [{ ROW_COUNT: 3, OBJECT_TYPE: 'U' }] as T[]
    }

    const schema = await mssqlTableSchema(rows, 'sales', 'customers')

    expect(schema.columns[0]).toMatchObject({
      name: 'email',
      sqlServerMaskingFunction: 'email()',
    })
    expect(describeColumnGeneration(schema.columns[0]!)).toBe("MASKED WITH (FUNCTION = 'email()')")
    expect(reconstructCreate(schema, 'mssql')).toContain(
      "[email] nvarchar(100) MASKED WITH (FUNCTION = 'email()') NOT NULL",
    )
  })
})
