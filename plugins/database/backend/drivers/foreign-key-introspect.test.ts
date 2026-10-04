import { describe, expect, it } from 'bun:test'

import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'
import { mysqlTableSchema } from './mysql-introspect'

describe('foreign-key catalog semantics', () => {
  it('joins MySQL referential_constraints and preserves ordered composite actions', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('information_schema.columns'))
        return [
          {
            COLUMN_NAME: 'tenant_id',
            COLUMN_TYPE: 'bigint',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: '',
          },
          {
            COLUMN_NAME: 'tenant_region',
            COLUMN_TYPE: 'varchar(10)',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: '',
          },
        ] as T[]
      if (sql.includes('information_schema.key_column_usage')) {
        expect(sql).toContain('JOIN information_schema.referential_constraints')
        expect(sql).toContain('ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION')
        return [
          {
            CONSTRAINT_NAME: 'fk_tenant',
            COLUMN_NAME: 'tenant_id',
            REFERENCED_TABLE_SCHEMA: 'core',
            REFERENCED_TABLE_NAME: 'tenants',
            REFERENCED_COLUMN_NAME: 'id',
            UPDATE_RULE: 'CASCADE',
            DELETE_RULE: 'SET NULL',
          },
          {
            CONSTRAINT_NAME: 'fk_tenant',
            COLUMN_NAME: 'tenant_region',
            REFERENCED_TABLE_SCHEMA: 'core',
            REFERENCED_TABLE_NAME: 'tenants',
            REFERENCED_COLUMN_NAME: 'region',
            UPDATE_RULE: 'CASCADE',
            DELETE_RULE: 'SET NULL',
          },
        ] as T[]
      }
      if (sql.includes('information_schema.statistics')) return [] as T[]
      if (sql.includes('information_schema.views')) return [] as T[]
      return [{ TABLE_ROWS: 1, TABLE_TYPE: 'BASE TABLE' }] as T[]
    }

    expect((await mysqlTableSchema(rows, 'app', 'orders')).foreignKeys).toEqual([
      {
        name: 'fk_tenant',
        columns: ['tenant_id', 'tenant_region'],
        refSchema: 'core',
        refTable: 'tenants',
        refColumns: ['id', 'region'],
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    ])
  })

  it('preserves SQL Server actions, replication, disabled, and trust flags', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS'))
        return [
          {
            COLUMN_NAME: 'account_id',
            DATA_TYPE: 'int',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
          },
        ] as T[]
      if (sql.includes('idx.is_primary_key = 1')) return [] as T[]
      if (sql.includes('FROM sys.foreign_keys')) {
        expect(sql).toContain('fk.name AS CONSTRAINT_NAME')
        expect(sql).toContain('fk.update_referential_action_desc AS UPDATE_ACTION')
        expect(sql).toContain('fk.delete_referential_action_desc AS DELETE_ACTION')
        expect(sql).toContain('fk.is_not_for_replication AS NOT_FOR_REPLICATION')
        expect(sql).toContain('fk.is_disabled AS IS_DISABLED')
        expect(sql).toContain('fk.is_not_trusted AS IS_NOT_TRUSTED')
        return [
          {
            CONSTRAINT_NAME: 'FK_orders_accounts',
            COLUMN_NAME: 'account_id',
            REF_SCHEMA: 'identity',
            REF_TABLE: 'accounts',
            REF_COLUMN: 'id',
            UPDATE_ACTION: 'SET_NULL',
            DELETE_ACTION: 'CASCADE',
            NOT_FOR_REPLICATION: true,
            IS_DISABLED: true,
            IS_NOT_TRUSTED: true,
          },
        ] as T[]
      }
      if (sql.includes('FROM sys.check_constraints')) return [] as T[]
      if (sql.includes('FROM sys.indexes')) return [] as T[]
      if (sql.includes('OBJECT_DEFINITION')) return [] as T[]
      return [{ ROW_COUNT: 4, OBJECT_TYPE: 'U' }] as T[]
    }

    expect((await mssqlTableSchema(rows, 'sales', 'orders')).foreignKeys).toEqual([
      {
        name: 'FK_orders_accounts',
        columns: ['account_id'],
        refSchema: 'identity',
        refTable: 'accounts',
        refColumns: ['id'],
        onUpdate: 'SET NULL',
        onDelete: 'CASCADE',
        notForReplication: true,
        disabled: true,
        notTrusted: true,
      },
    ])
  })
})
