import { describe, expect, it } from 'bun:test'
import type { DbTableSchema } from '../dbClient'
import { buildAlterTablePlan, createAlterColumnDrafts } from './alterTable'

/**
 * A PostgreSQL table with the three column kinds the engine fills itself. The shapes match
 * what `pgTableSchema` actually returns (see postgres-introspect.test.ts, "preserves
 * identity, generated, and owned-sequence column metadata"): both the identity and the
 * generated column report `defaultValue: null`, which is precisely why they used to look
 * like ordinary columns in the editor.
 */
const table: DbTableSchema = {
  name: 'orders',
  schema: 'sales',
  type: 'table',
  columns: [
    {
      name: 'id',
      dataType: 'bigint',
      nullable: false,
      pk: true,
      defaultValue: null,
      identity: { generation: 'ALWAYS' },
    },
    {
      name: 'legacy_id',
      dataType: 'integer',
      nullable: false,
      pk: false,
      defaultValue: "nextval('sales.legacy_seq'::regclass)",
      ownedSequence: {
        schema: 'sales',
        name: 'legacy_seq',
        dataType: 'integer',
        start: '1',
        increment: '1',
        minValue: '1',
        maxValue: '2147483647',
        cache: '1',
        cycle: false,
      },
    },
    {
      name: 'total',
      dataType: 'numeric',
      nullable: true,
      pk: false,
      defaultValue: null,
      generated: { expression: '(quantity * unit_price)', storage: 'STORED' },
    },
    { name: 'note', dataType: 'text', nullable: true, pk: false, defaultValue: null },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
}

const draftsFor = () => createAlterColumnDrafts(table)

describe('buildAlterTablePlan — columns the engine fills itself', () => {
  it('refuses to give a generated column a default', () => {
    const drafts = draftsFor()
    drafts[2] = { ...drafts[2], defaultValue: '0' }
    // PostgreSQL, "Generated Columns": they "cannot have their own column defaults or
    // identity definitions". The old planner happily emitted
    // `ALTER COLUMN "total" SET DEFAULT 0`, which the engine rejects.
    expect(() => buildAlterTablePlan('postgres', table, drafts)).toThrow(
      /total is a generated column/,
    )
  })

  it('refuses to make an identity column nullable', () => {
    const drafts = draftsFor()
    // Not via `nullable` alone: `id` is the primary key, and the UI already blocks that.
    // Drop it from the primary key in the draft so only the identity rule can stop this.
    drafts[0] = { ...drafts[0], nullable: true, primaryKey: false }
    // PostgreSQL, CREATE TABLE: an identity column "is implicitly NOT NULL".
    expect(() => buildAlterTablePlan('postgres', table, drafts)).toThrow(/id is an identity column/)
  })

  it('still allows every edit those rules do not cover', () => {
    const drafts = draftsFor()
    // Renaming a generated column is fine; so is retyping an identity column.
    drafts[2] = { ...drafts[2], name: 'line_total' }
    drafts[0] = { ...drafts[0], dataType: 'integer' }
    const plan = buildAlterTablePlan('postgres', table, drafts)
    expect(plan.statements).toEqual([
      'ALTER TABLE "sales"."orders" ALTER COLUMN "id" TYPE integer;',
      'ALTER TABLE "sales"."orders" RENAME COLUMN "total" TO "line_total";',
    ])
  })

  it('leaves a serial column alone — clearing its default is legal, just consequential', () => {
    const drafts = draftsFor()
    drafts[1] = { ...drafts[1], defaultValue: '' }
    // No throw: DROP DEFAULT on a serial column is valid SQL. It orphans the sequence and
    // stops auto-numbering, which is why the editor names the sequence instead of blocking
    // the edit — a refusal here would forbid a legitimate migration step.
    expect(buildAlterTablePlan('postgres', table, drafts).statements).toEqual([
      'ALTER TABLE "sales"."orders" ALTER COLUMN "legacy_id" DROP DEFAULT;',
    ])
  })

  it('does not fire on a plain column', () => {
    const drafts = draftsFor()
    drafts[3] = { ...drafts[3], defaultValue: "'none'", nullable: true }
    expect(buildAlterTablePlan('postgres', table, drafts).statements).toEqual([
      `ALTER TABLE "sales"."orders" ALTER COLUMN "note" SET DEFAULT 'none';`,
    ])
  })
})
