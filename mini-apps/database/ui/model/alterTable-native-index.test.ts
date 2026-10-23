import { describe, expect, it } from 'bun:test'

import type { DbTableSchema } from '../dbClient'
import { buildAlterTablePlan, createAlterColumnDrafts } from './alterTable'

const table: DbTableSchema = {
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
      name: 'users_active_email_idx',
      columns: [],
      unique: true,
      createScript:
        'CREATE UNIQUE INDEX users_active_email_idx ON users(lower(email)) ' +
        'WHERE email IS NOT NULL',
      createScriptOnly: true,
    },
  ],
  triggers: [
    {
      name: 'users_email_audit',
      createScript:
        'CREATE TRIGGER users_email_audit AFTER UPDATE OF email ON users ' +
        'BEGIN SELECT NEW.email; END',
    },
  ],
  createScript: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)',
}

describe('SQLite rebuilds with native-only indexes', () => {
  it('reuses authoritative index DDL when existing column names stay unchanged', () => {
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1], dataType: 'VARCHAR(255)' }

    const plan = buildAlterTablePlan('sqlite', table, drafts)

    expect(plan.sql).toContain(
      'CREATE UNIQUE INDEX users_active_email_idx ON users(lower(email)) ' +
        'WHERE email IS NOT NULL;',
    )
    expect(plan.sql).toContain(
      'CREATE TRIGGER users_email_audit AFTER UPDATE OF email ON users ' +
        'BEGIN SELECT NEW.email; END;',
    )
  })

  it('omits native-only DDL with an explicit warning when a column is renamed', () => {
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1], name: 'login', dataType: 'VARCHAR(255)' }

    const plan = buildAlterTablePlan('sqlite', table, drafts)

    expect(plan.sql).not.toContain('CREATE UNIQUE INDEX users_active_email_idx')
    expect(plan.warnings).toContain(
      'Index users_active_email_idx is omitted because its native expression or predicate cannot be safely rewritten after a column rename/drop.',
    )
    expect(plan.warnings).toContain(
      'Trigger users_email_audit is omitted because its native body cannot be safely rewritten after a column rename/drop.',
    )
  })
})
