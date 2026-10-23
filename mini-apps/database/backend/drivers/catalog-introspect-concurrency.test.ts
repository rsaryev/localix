import { describe, expect, it } from 'bun:test'
import { buildTriggerStatements } from '../ddl'
import type { RowsExecutor } from './fk-rows'
import { mssqlTableSchema } from './mssql-introspect'
import { mysqlTableSchema } from './mysql-introspect'

function deferred() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('catalog introspection concurrency', () => {
  it('starts all MySQL table catalog reads together once the schema is known', async () => {
    const gate = deferred()
    let started = 0
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      started += 1
      await gate.promise
      if (sql.includes('information_schema.columns')) {
        return [
          {
            COLUMN_NAME: 'id',
            COLUMN_TYPE: 'bigint unsigned',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: 'PRI',
          },
        ] as T[]
      }
      if (sql.includes('key_column_usage')) return [] as T[]
      if (sql.includes('information_schema.statistics')) {
        return [
          {
            Key_name: 'PRIMARY',
            Column_name: 'id',
            Seq_in_index: 1,
            Non_unique: 0,
            Is_constraint: 1,
            Collation: 'A',
            Sub_part: null,
          },
        ] as T[]
      }
      return [{ TABLE_ROWS: 17, TABLE_TYPE: 'BASE TABLE' }] as T[]
    }

    const schemaPromise = mysqlTableSchema(rows, 'app', 'items')
    await Promise.resolve()
    try {
      expect(started).toBe(6)
    } finally {
      gate.release()
    }
    expect(await schemaPromise).toMatchObject({
      schema: 'app',
      type: 'table',
      primaryKey: ['id'],
      approxRows: 17,
      columns: [{ dataType: 'bigint unsigned' }],
      indexes: [{ name: 'PRIMARY', columns: ['id'], primary: true }],
    })
  })

  it('reads MySQL indexes from the parameterized catalog and omits functional indexes', async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = []
    const rows: RowsExecutor = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      calls.push({ sql, params })
      if (sql.includes('information_schema.columns')) {
        return [
          {
            COLUMN_NAME: 'id',
            COLUMN_TYPE: 'bigint',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: 'PRI',
          },
        ] as T[]
      }
      if (sql.includes('key_column_usage')) return [] as T[]
      if (sql.includes('information_schema.statistics')) {
        return [
          {
            Key_name: 'PRIMARY',
            Column_name: 'id',
            Seq_in_index: 1,
            Non_unique: 0,
            Is_constraint: 1,
            Collation: 'A',
            Sub_part: null,
          },
          {
            Key_name: 'idx_functional',
            Column_name: null,
            Seq_in_index: 1,
            Non_unique: 1,
            Is_constraint: 0,
            Collation: null,
            Sub_part: null,
          },
        ] as T[]
      }
      return [{ TABLE_ROWS: 17, TABLE_TYPE: 'BASE TABLE' }] as T[]
    }

    const schema = await mysqlTableSchema(rows, 'app', 'items')

    expect(schema.indexes).toEqual([
      {
        name: 'PRIMARY',
        columns: ['id'],
        unique: true,
        primary: true,
        constraint: true,
        orders: ['asc'],
        prefixLengths: [null],
      },
    ])
    const indexCall = calls.find(({ sql }) => sql.includes('information_schema.statistics'))
    expect(indexCall?.params).toEqual(['app', 'items'])
    expect(indexCall?.sql).not.toContain('SHOW INDEX')
  })

  it('uses schema-qualified SHOW CREATE for tables and marks its embedded indexes', async () => {
    const calls: string[] = []
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      calls.push(sql)
      if (sql.includes('information_schema.columns'))
        return [
          {
            COLUMN_NAME: 'id',
            COLUMN_TYPE: 'bigint',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: 'PRI',
          },
        ] as T[]
      if (
        sql.includes('information_schema.key_column_usage') ||
        sql.includes('information_schema.statistics') ||
        sql.includes('information_schema.views')
      )
        return [] as T[]
      if (sql.startsWith('SHOW CREATE TABLE'))
        return [
          {
            Table: 'orders`archive',
            'Create Table':
              'CREATE TABLE `orders``archive` (\n' +
              '  `id` bigint NOT NULL AUTO_INCREMENT,\n' +
              '  `slug` varchar(255) GENERATED ALWAYS AS (lower(`name`)) STORED,\n' +
              '  PRIMARY KEY (`id`),\n' +
              '  KEY `idx_slug` (`slug`)\n' +
              ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
          },
        ] as T[]
      return [{ TABLE_ROWS: 3, TABLE_TYPE: 'BASE TABLE' }] as T[]
    }

    expect(await mysqlTableSchema(rows, 'tenant`one', 'orders`archive')).toMatchObject({
      createScript:
        'CREATE TABLE `tenant``one`.`orders``archive` (\n' +
        '  `id` bigint NOT NULL AUTO_INCREMENT,\n' +
        '  `slug` varchar(255) GENERATED ALWAYS AS (lower(`name`)) STORED,\n' +
        '  PRIMARY KEY (`id`),\n' +
        '  KEY `idx_slug` (`slug`)\n' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      createScriptIncludesIndexes: true,
    })
    expect(calls).toContain('SHOW CREATE TABLE `tenant``one`.`orders``archive`')
  })

  it('preserves MySQL trigger bodies, action order, and execution context without a definer', async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = []
    const rows: RowsExecutor = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      calls.push({ sql, params })
      if (sql.includes('information_schema.triggers')) {
        return [
          {
            TRIGGER_NAME: 'audit`first',
            EVENT_MANIPULATION: 'UPDATE',
            ACTION_TIMING: 'BEFORE',
            ACTION_STATEMENT: 'SET NEW.updated_at = CURRENT_TIMESTAMP',
            ACTION_ORDER: 1,
            SQL_MODE: 'STRICT_TRANS_TABLES,NO_ZERO_DATE',
            CHARACTER_SET_CLIENT: 'utf8mb4',
            COLLATION_CONNECTION: 'utf8mb4_0900_ai_ci',
          },
          {
            TRIGGER_NAME: 'audit_second',
            EVENT_MANIPULATION: 'UPDATE',
            ACTION_TIMING: 'BEFORE',
            ACTION_STATEMENT:
              'BEGIN INSERT INTO audit_log(order_id) VALUES (NEW.id); SET NEW.version = OLD.version + 1; END;',
            ACTION_ORDER: 2,
            SQL_MODE: '',
            CHARACTER_SET_CLIENT: 'latin1',
            COLLATION_CONNECTION: 'latin1_swedish_ci',
          },
        ] as T[]
      }
      if (sql.includes('information_schema.tables'))
        return [{ TABLE_ROWS: 3, TABLE_TYPE: 'BASE TABLE' }] as T[]
      return [] as T[]
    }

    const schema = await mysqlTableSchema(rows, 'tenant`one', 'orders`archive')

    expect(schema.triggers?.map((trigger) => trigger.name)).toEqual(['audit`first', 'audit_second'])
    expect(schema.triggers?.[0]).toEqual({
      name: 'audit`first',
      createScript:
        'CREATE TRIGGER `tenant``one`.`audit``first` BEFORE UPDATE ' +
        'ON `tenant``one`.`orders``archive` FOR EACH ROW\n' +
        'SET NEW.updated_at = CURRENT_TIMESTAMP',
      preCreateScripts: [
        "SET @LOCALIX_TRIGGER_OLD_SQL_MODE = @@SESSION.SQL_MODE, @@SESSION.SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_DATE'",
        "SET @LOCALIX_TRIGGER_OLD_CHARACTER_SET_CLIENT = @@SESSION.CHARACTER_SET_CLIENT, @@SESSION.CHARACTER_SET_CLIENT = 'utf8mb4'",
        "SET @LOCALIX_TRIGGER_OLD_COLLATION_CONNECTION = @@SESSION.COLLATION_CONNECTION, @@SESSION.COLLATION_CONNECTION = 'utf8mb4_0900_ai_ci'",
      ],
      postCreateScripts: [
        'SET @@SESSION.COLLATION_CONNECTION = @LOCALIX_TRIGGER_OLD_COLLATION_CONNECTION',
        'SET @@SESSION.CHARACTER_SET_CLIENT = @LOCALIX_TRIGGER_OLD_CHARACTER_SET_CLIENT',
        'SET @@SESSION.SQL_MODE = @LOCALIX_TRIGGER_OLD_SQL_MODE',
      ],
    })
    const statements = buildTriggerStatements(schema)
    expect(
      statements.indexOf(
        'CREATE TRIGGER `tenant``one`.`audit``first` BEFORE UPDATE ON ' +
          '`tenant``one`.`orders``archive` FOR EACH ROW\nSET NEW.updated_at = CURRENT_TIMESTAMP;',
      ),
    ).toBe(3)
    expect(statements).toContain(
      'CREATE TRIGGER `tenant``one`.`audit_second` BEFORE UPDATE ON ' +
        '`tenant``one`.`orders``archive` FOR EACH ROW\n' +
        'BEGIN INSERT INTO audit_log(order_id) VALUES (NEW.id); ' +
        'SET NEW.version = OLD.version + 1; END;',
    )
    const triggerCall = calls.find(({ sql }) => sql.includes('information_schema.triggers'))
    expect(triggerCall?.params).toEqual(['tenant`one', 'orders`archive'])
    expect(triggerCall?.sql).toContain(
      'ORDER BY ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER, TRIGGER_NAME',
    )
    expect(statements.join('\n')).not.toContain('DEFINER')
  })

  it('introspects MySQL views without issuing a table-only SHOW INDEX statement', async () => {
    const rows: RowsExecutor = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('SHOW INDEX')) throw new Error('SHOW INDEX must not run for a view')
      if (sql.includes('SHOW CREATE TABLE'))
        throw new Error('SHOW CREATE TABLE must not run for a view')
      if (sql.includes('information_schema.columns')) {
        return [
          {
            COLUMN_NAME: 'display_name',
            COLUMN_TYPE: 'varchar(255)',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: '',
          },
        ] as T[]
      }
      if (sql.includes('key_column_usage') || sql.includes('information_schema.statistics')) {
        return [] as T[]
      }
      if (sql.includes('information_schema.views')) {
        return [
          {
            VIEW_DEFINITION:
              ' select `app`.`users`.`display_name` AS `display_name` from `app`.`users`; ',
            CHECK_OPTION: 'LOCAL',
            SECURITY_TYPE: 'INVOKER',
          },
        ] as T[]
      }
      return [{ TABLE_ROWS: null, TABLE_TYPE: 'VIEW' }] as T[]
    }

    expect(await mysqlTableSchema(rows, 'app', 'active`users')).toMatchObject({
      type: 'view',
      primaryKey: [],
      indexes: [],
      approxRows: undefined,
      createScript:
        'CREATE SQL SECURITY INVOKER VIEW `app`.`active``users` AS\n' +
        'select `app`.`users`.`display_name` AS `display_name` from `app`.`users`\n' +
        'WITH LOCAL CHECK OPTION;',
    })
  })

  it('starts all SQL Server table catalog reads together', async () => {
    const gate = deferred()
    let started = 0
    const rows: RowsExecutor = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      started += 1
      await gate.promise
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'uniqueidentifier',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
          },
          {
            COLUMN_NAME: 'title',
            DATA_TYPE: 'nvarchar',
            CHARACTER_MAXIMUM_LENGTH: 255,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
          },
          {
            COLUMN_NAME: 'amount',
            DATA_TYPE: 'decimal',
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 18,
            NUMERIC_SCALE: 2,
            DATETIME_PRECISION: null,
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
          },
        ] as T[]
      }
      if (sql.includes('idx.is_primary_key = 1')) {
        expect(sql).toContain('JOIN sys.schemas')
        expect(sql).toContain('sch.name = ? AND obj.name = ?')
        expect(sql).toContain('ORDER BY idx_col.key_ordinal')
        return [{ COLUMN_NAME: 'id' }] as T[]
      }
      if (sql.includes('FROM sys.foreign_keys')) {
        expect(sql).toContain('JOIN sys.foreign_key_columns')
        expect(sql).toContain('fkc.parent_column_id')
        expect(sql).toContain('fkc.referenced_column_id')
        expect(sql).toContain('ORDER BY fk.object_id, fkc.constraint_column_id')
        return [] as T[]
      }
      if (sql.includes('FROM sys.check_constraints')) return [] as T[]
      if (sql.includes('FROM sys.triggers trigger_info')) {
        expect(sql).toContain('LEFT JOIN sys.sql_modules trigger_module')
        expect(sql).toContain('LEFT JOIN sys.trigger_events trigger_event')
        expect(sql).not.toContain('sys.assembly_modules')
        expect(sql).toContain("trigger_info.type IN ('TR', 'TA')")
        const sqlTrigger = {
          TRIGGER_ID: 1,
          TRIGGER_NAME: 'audit]items',
          TRIGGER_TYPE: 'TR',
          DEFINITION:
            'ALTER TRIGGER [dbo].[items_before_rename] -- ON fake target\n' +
            'ON [dbo].[items_before_rename]\n' +
            'WITH EXECUTE AS OWNER\n' +
            'AFTER INSERT, UPDATE\n' +
            'NOT FOR REPLICATION\n' +
            'AS\n' +
            "BEGIN SELECT N'ON AFTER in a literal'; END;",
          IS_DISABLED: true,
          IS_INSTEAD_OF: false,
          NOT_FOR_REPLICATION: true,
          USES_ANSI_NULLS: false,
          USES_QUOTED_IDENTIFIER: true,
        }
        return [
          {
            ...sqlTrigger,
            EVENT_TYPE: 'INSERT',
            IS_FIRST: true,
            IS_LAST: false,
          },
          {
            ...sqlTrigger,
            EVENT_TYPE: 'UPDATE',
            IS_FIRST: false,
            IS_LAST: true,
          },
          {
            TRIGGER_ID: 2,
            TRIGGER_NAME: 'clr_audit',
            TRIGGER_TYPE: 'TA',
            DEFINITION: null,
            IS_DISABLED: false,
            IS_INSTEAD_OF: false,
            NOT_FOR_REPLICATION: true,
            USES_ANSI_NULLS: null,
            USES_QUOTED_IDENTIFIER: null,
            EVENT_TYPE: 'DELETE',
            IS_FIRST: false,
            IS_LAST: false,
          },
          {
            TRIGGER_ID: 3,
            TRIGGER_NAME: 'encrypted_audit',
            TRIGGER_TYPE: 'TR',
            DEFINITION: null,
            IS_DISABLED: false,
            IS_INSTEAD_OF: false,
            NOT_FOR_REPLICATION: false,
            USES_ANSI_NULLS: null,
            USES_QUOTED_IDENTIFIER: null,
            EVENT_TYPE: 'INSERT',
            IS_FIRST: false,
            IS_LAST: false,
          },
          {
            TRIGGER_ID: 4,
            TRIGGER_NAME: 'clr_hidden_principal',
            TRIGGER_TYPE: 'TA',
            DEFINITION: null,
            IS_DISABLED: false,
            IS_INSTEAD_OF: false,
            NOT_FOR_REPLICATION: false,
            USES_ANSI_NULLS: null,
            USES_QUOTED_IDENTIFIER: null,
            EVENT_TYPE: 'UPDATE',
            IS_FIRST: false,
            IS_LAST: false,
          },
        ] as T[]
      }
      if (sql.includes('FROM sys.assembly_modules assembly_module')) {
        expect(sql).toContain('JOIN sys.assemblies assembly_info')
        expect(sql).toContain('LEFT JOIN sys.database_principals execute_principal')
        expect(sql).toContain('assembly_module.object_id IN (?, ?)')
        expect(params).toEqual([2, 4])
        return [
          {
            TRIGGER_ID: 2,
            ASSEMBLY_NAME: 'Audit.Assembly',
            ASSEMBLY_CLASS: 'Audit.Triggers',
            ASSEMBLY_METHOD: 'OnDelete',
            EXECUTE_AS_PRINCIPAL_ID: -2,
            EXECUTE_AS_NAME: null,
          },
          {
            TRIGGER_ID: 4,
            ASSEMBLY_NAME: 'HiddenPrincipal.Assembly',
            ASSEMBLY_CLASS: 'Audit.Triggers',
            ASSEMBLY_METHOD: 'OnUpdate',
            EXECUTE_AS_PRINCIPAL_ID: 7,
            EXECUTE_AS_NAME: null,
          },
        ] as T[]
      }
      if (sql.includes('FROM sys.indexes')) {
        expect(sql).toContain('JOIN sys.schemas')
        expect(sql).not.toContain('OBJECT_ID')
        expect(sql).toContain('i.type IN (1, 2)')
        expect(sql).not.toContain('i.has_filter = 0')
        expect(sql).toContain('i.filter_definition AS FILTER_DEFINITION')
        expect(sql).toContain('i.is_disabled = 0')
        expect(sql).toContain('ic.key_ordinal > 0 OR ic.is_included_column = 1')
        expect(sql).toContain('ic.is_descending_key AS IS_DESCENDING')
        expect(sql).toContain('i.type AS INDEX_TYPE')
        return [
          {
            INDEX_NAME: 'PK_items',
            COLUMN_NAME: 'id',
            KEY_ORDINAL: 1,
            IS_UNIQUE: true,
            IS_PRIMARY: true,
            IS_CONSTRAINT: false,
            IS_INCLUDED: false,
            IS_DESCENDING: false,
            INDEX_COLUMN_ID: 1,
            INDEX_TYPE: 1,
            FILTER_DEFINITION: null,
          },
        ] as T[]
      }
      if (sql.includes('OBJECT_DEFINITION')) {
        expect(sql).toContain('FROM sys.views')
        expect(sql).toContain('JOIN sys.schemas')
        expect(sql).toContain('LEFT JOIN sys.sql_modules')
        return [
          {
            DEFINITION:
              'ALTER VIEW [dbo].[items_before_rename]\n' +
              'WITH SCHEMABINDING, VIEW_METADATA\n' +
              'AS\n' +
              "SELECT id, title, amount FROM dbo.source_items WHERE title <> N'AS in a literal'\n" +
              'WITH CHECK OPTION;',
            IS_SCHEMA_BOUND: true,
            HAS_VIEW_METADATA: true,
          },
        ] as T[]
      }
      expect(sql).toContain('LEFT JOIN sys.dm_db_partition_stats')
      expect(sql).toContain('JOIN sys.schemas')
      expect(sql).not.toContain('OBJECT_ID')
      return [{ ROW_COUNT: 23, OBJECT_TYPE: 'V' }] as T[]
    }

    const schemaPromise = mssqlTableSchema(rows, 'dbo', 'items]now')
    await Promise.resolve()
    try {
      expect(started).toBe(8)
    } finally {
      gate.release()
    }
    expect(await schemaPromise).toMatchObject({
      schema: 'dbo',
      type: 'view',
      primaryKey: ['id'],
      keyConstraints: [
        {
          name: 'PK_items',
          type: 'PRIMARY KEY',
          columns: ['id'],
          orders: ['asc'],
          clustered: true,
        },
      ],
      approxRows: 23,
      columns: [
        { name: 'id', dataType: 'uniqueidentifier' },
        { name: 'title', dataType: 'nvarchar(255)' },
        { name: 'amount', dataType: 'decimal(18,2)' },
      ],
      triggers: [
        {
          name: 'audit]items',
          preCreateScripts: ['SET ANSI_NULLS OFF', 'SET QUOTED_IDENTIFIER ON'],
          createScript:
            'CREATE TRIGGER [dbo].[audit]]items]\n' +
            'ON [dbo].[items]]now]\n' +
            'WITH EXECUTE AS OWNER\n' +
            'AFTER INSERT, UPDATE\n' +
            'NOT FOR REPLICATION\n' +
            'AS\n' +
            "BEGIN SELECT N'ON AFTER in a literal'; END;",
          postCreateScripts: [
            "EXEC sys.sp_settriggerorder @triggername = N'[dbo].[audit]]items]', @order = N'First', @stmttype = N'INSERT'",
            "EXEC sys.sp_settriggerorder @triggername = N'[dbo].[audit]]items]', @order = N'Last', @stmttype = N'UPDATE'",
            'DISABLE TRIGGER [dbo].[audit]]items] ON [dbo].[items]]now]',
          ],
        },
        {
          name: 'clr_audit',
          createScript:
            'CREATE TRIGGER [dbo].[clr_audit]\n' +
            'ON [dbo].[items]]now]\n' +
            'WITH EXECUTE AS OWNER\n' +
            'AFTER DELETE\n' +
            'NOT FOR REPLICATION\n' +
            'AS EXTERNAL NAME [Audit.Assembly].[Audit.Triggers].[OnDelete]',
        },
        {
          name: 'encrypted_audit',
          createScript: '-- Definition unavailable for SQL Server trigger [dbo].[encrypted_audit]',
          definitionUnavailable: true,
        },
        {
          name: 'clr_hidden_principal',
          createScript:
            '-- Definition unavailable for SQL Server trigger [dbo].[clr_hidden_principal]',
          definitionUnavailable: true,
        },
      ],
      createScript:
        'CREATE VIEW [dbo].[items]]now] ([id], [title], [amount])\n' +
        'WITH SCHEMABINDING, VIEW_METADATA\n' +
        'AS\n' +
        "SELECT id, title, amount FROM dbo.source_items WHERE title <> N'AS in a literal'\n" +
        'WITH CHECK OPTION;',
    })
  })
})
