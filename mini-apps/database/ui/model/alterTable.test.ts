import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { DbTableSchema } from '../dbClient'
import { buildAlterTablePlan, createAlterColumnDrafts, createNewColumnDraft } from './alterTable'
import { splitStatements } from '../../shared/sql-statements'

const users: DbTableSchema = {
  schema: 'public',
  name: 'users',
  type: 'table',
  columns: [
    { name: 'id', dataType: 'integer', nullable: false, pk: true },
    { name: 'email', dataType: 'text', nullable: false, pk: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
}

describe('table structure change planner', () => {
  test('generates staged PostgreSQL column changes', () => {
    const drafts = createAlterColumnDrafts(users)
    drafts[1] = {
      ...drafts[1],
      name: 'login',
      dataType: 'varchar(255)',
      nullable: true,
      defaultValue: "''",
    }
    const plan = buildAlterTablePlan('postgres', users, drafts)
    expect(plan.changeCount).toBe(4)
    expect(plan.sql).toContain('RENAME COLUMN "email" TO "login"')
    expect(plan.sql).toContain('ALTER COLUMN "login" TYPE varchar(255)')
    expect(plan.sql).toContain('ALTER COLUMN "login" DROP NOT NULL')
    expect(plan.sql).toContain(`ALTER COLUMN "login" SET DEFAULT ''`)
  })

  test('uses attribute-preserving MySQL clauses for rename and default changes', () => {
    const table = { ...users, schema: undefined }
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1], name: 'login', defaultValue: "'pending'" }
    expect(buildAlterTablePlan('mysql', table, drafts).sql).toBe(
      'ALTER TABLE `users`\n' +
        '  RENAME COLUMN `email` TO `login`,\n' +
        "  ALTER COLUMN `login` SET DEFAULT 'pending';",
    )
    expect(buildAlterTablePlan('mysql', table, drafts).statements).toHaveLength(1)
  })

  test('fails closed on MySQL definition rewrites that would drop native attributes', () => {
    const table = { ...users, schema: undefined }
    const changedType = createAlterColumnDrafts(table)
    changedType[1] = { ...changedType[1], dataType: 'varchar(255)' }
    expect(() => buildAlterTablePlan('mysql', table, changedType)).toThrow(
      'Changing existing column types is not supported',
    )

    const changedNullability = createAlterColumnDrafts(table)
    changedNullability[1] = { ...changedNullability[1], nullable: true }
    expect(() => buildAlterTablePlan('mysql', table, changedNullability)).toThrow(
      'Changing nullability is not supported',
    )
  })

  test('rebuilds a SQLite table for type, nullability and default changes', () => {
    const table = {
      ...users,
      schema: 'main',
      indexes: [
        {
          name: 'users_email_idx',
          columns: ['email'],
          unique: true,
          primary: false,
        },
      ],
    }
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = {
      ...drafts[1],
      name: 'login',
      dataType: 'INTEGER',
      nullable: true,
      defaultValue: '0',
    }
    const plan = buildAlterTablePlan('sqlite', table, drafts)
    expect(plan.changeCount).toBe(4)
    expect(plan.sql).toContain('BEGIN IMMEDIATE')
    expect(plan.sql).toContain('PRAGMA defer_foreign_keys = ON')
    expect(plan.sql).toContain('CREATE TABLE "main"."__localix_new_users"')
    expect(plan.sql).toContain('"login" INTEGER NULL DEFAULT 0')
    expect(plan.sql).toContain('INSERT INTO "main"."__localix_new_users" ("id", "login")')
    expect(plan.sql).toContain('SELECT "id", "email" FROM "main"."users"')
    expect(plan.sql).toContain('CREATE UNIQUE INDEX "main"."users_email_idx" ON "users" ("login")')
    expect(plan.sql).toContain('PRAGMA foreign_key_check')
    expect(plan.statements).not.toContain('BEGIN IMMEDIATE;')
    expect(plan.statements).not.toContain('COMMIT;')
    expect(plan.warnings.join(' ')).toContain('rebuild')
    expect(plan.warnings.join(' ')).toContain('Automatic apply is disabled')
    expect(plan.manualOnly).toBe(true)
  })

  test('SQLite rebuild SQL preserves rows, the primary key and explicit indexes', () => {
    const db = new Database(':memory:')
    try {
      db.exec(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL); CREATE UNIQUE INDEX users_email_idx ON users(email); INSERT INTO users VALUES (1, '7');",
      )
      const table: DbTableSchema = {
        schema: undefined,
        name: 'users',
        type: 'table',
        columns: [
          { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
          { name: 'email', dataType: 'TEXT', nullable: false, pk: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        indexes: [
          {
            name: 'users_email_idx',
            columns: ['email'],
            unique: true,
            primary: false,
          },
        ],
        createScript: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)',
      }
      const drafts = createAlterColumnDrafts(table)
      drafts[1] = {
        ...drafts[1],
        name: 'login',
        dataType: 'INTEGER',
        nullable: true,
        defaultValue: '0',
      }
      const plan = buildAlterTablePlan('sqlite', table, drafts)
      for (const statement of splitStatements(plan.sql)) db.exec(statement)

      const columns = db.query('PRAGMA table_info(users)').all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
      }>
      expect(columns.map((column) => column.name)).toEqual(['id', 'login'])
      expect(columns[0]?.pk).toBe(1)
      expect(columns[1]).toMatchObject({ type: 'INTEGER', notnull: 0 })
      expect(db.query('SELECT id, login FROM users').get()).toEqual({ id: 1, login: 7 })
      expect(
        (
          db.query('PRAGMA index_list(users)').all() as Array<{
            name: string
            unique: number
          }>
        ).find((index) => index.name === 'users_email_idx'),
      ).toMatchObject({ unique: 1 })
    } finally {
      db.close()
    }
  })

  test('supports safe SQLite rename, add and drop syntax', () => {
    const table = { ...users, schema: 'main' }
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1], name: 'login' }
    drafts.push({ ...createNewColumnDraft('new:1', 'TEXT'), name: 'bio' })
    const plan = buildAlterTablePlan('sqlite', table, drafts)
    expect(plan.manualOnly).toBeUndefined()
    expect(plan.sql).toContain('ALTER TABLE "main"."users" RENAME COLUMN "email" TO "login";')
    expect(plan.sql).toContain('ALTER TABLE "main"."users" ADD COLUMN "bio" TEXT NULL;')
  })

  test('quotes every SQL Server object-name part passed to sp_rename', () => {
    const table = {
      ...users,
      schema: 'sales.ops',
      name: 'user.data',
      columns: users.columns.map((column) =>
        column.name === 'email' ? { ...column, name: 'email]address' } : column,
      ),
    }
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1], name: "login'name" }
    const sql = buildAlterTablePlan('mssql', table, drafts).sql
    expect(sql).toBe(
      `EXEC sp_rename N'[sales.ops].[user.data].[email]]address]', N'login''name', 'COLUMN';`,
    )
  })

  test('fails closed on SQL Server definition rewrites that lose native attributes', () => {
    const table = { ...users, schema: 'dbo' }
    const changedType = createAlterColumnDrafts(table)
    changedType[1] = { ...changedType[1], dataType: 'NVARCHAR(255)' }
    expect(() => buildAlterTablePlan('mssql', table, changedType)).toThrow(
      'Changing existing column types is not supported',
    )

    const changedNullability = createAlterColumnDrafts(table)
    changedNullability[1] = { ...changedNullability[1], nullable: true }
    expect(() => buildAlterTablePlan('mssql', table, changedNullability)).toThrow(
      'Changing nullability is not supported',
    )
  })

  test('validates duplicate names and warns on destructive drafts', () => {
    const drafts = createAlterColumnDrafts(users)
    drafts[1] = { ...drafts[1], name: 'id' }
    expect(() => buildAlterTablePlan('postgres', users, drafts)).toThrow(
      'Column names must be unique',
    )

    const dropped = createAlterColumnDrafts(users)
    dropped[1] = { ...dropped[1], deleted: true }
    expect(buildAlterTablePlan('postgres', users, dropped).warnings[0]).toContain(
      'permanently removes',
    )
  })

  test('rejects an unsafe or duplicated DEFAULT expression before generating SQL', () => {
    const drafts = createAlterColumnDrafts(users)
    drafts[1] = { ...drafts[1], defaultValue: 'DEFAULT 1' }
    expect(() => buildAlterTablePlan('postgres', users, drafts)).toThrow(
      'DEFAULT is added automatically',
    )

    drafts[1] = { ...drafts[1], defaultValue: '1; DROP TABLE users' }
    expect(() => buildAlterTablePlan('postgres', users, drafts)).toThrow(
      'one expression without a trailing semicolon',
    )
  })
})
