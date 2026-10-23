import { describe, expect, it } from 'bun:test'

import type { DbTableSchema } from '../dbClient'
import { buildAlterTablePlan, createAlterColumnDrafts } from './alterTable'

describe('SQLite rebuild foreign keys', () => {
  it('preserves referential actions and an implicit referenced primary key', () => {
    const table: DbTableSchema = {
      name: 'children',
      type: 'table',
      columns: [
        { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
        { name: 'parent_id', dataType: 'INTEGER', nullable: true, pk: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          columns: ['parent_id'],
          refTable: 'parents',
          refColumns: [],
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
      ],
      indexes: [],
      createScript:
        'CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents ON DELETE SET NULL ON UPDATE CASCADE)',
    }
    const drafts = createAlterColumnDrafts(table)
    drafts[1] = { ...drafts[1]!, nullable: false }

    const plan = buildAlterTablePlan('sqlite', table, drafts)

    expect(plan.manualOnly).toBe(true)
    expect(plan.sql).toContain(
      'FOREIGN KEY ("parent_id") REFERENCES "parents" ON DELETE SET NULL ON UPDATE CASCADE',
    )
  })
})
