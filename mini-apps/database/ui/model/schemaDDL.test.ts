import { describe, expect, it } from 'bun:test'
import type { DbTableSchema } from '../dbClient'
import { buildSchemaDump, buildTableDDL } from './schemaDDL'

const base: DbTableSchema = {
  name: 'users',
  type: 'table',
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
  columns: [
    { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
    { name: 'name', dataType: 'TEXT', nullable: false, pk: false },
    { name: 'org_id', dataType: 'INTEGER', nullable: true, pk: false },
  ],
}

describe('buildTableDDL', () => {
  it('prefers the engine createScript when present', () => {
    const sql = buildTableDDL(
      { ...base, createScript: 'CREATE TABLE users (id INTEGER)' },
      'sqlite',
    )
    expect(sql).toBe('CREATE TABLE users (id INTEGER)')
  })

  it('keeps standalone indexes beside a native CREATE and skips constraint backing indexes', () => {
    const sql = buildTableDDL(
      {
        ...base,
        createScript: 'CREATE TABLE users (id INTEGER, email TEXT UNIQUE)',
        indexes: [
          {
            name: 'sqlite_autoindex_users_1',
            columns: ['email'],
            unique: true,
            constraint: true,
          },
          {
            name: 'idx_email',
            columns: ['email'],
            unique: false,
            createScript: 'CREATE INDEX idx_email ON users(email DESC)',
          },
        ],
      },
      'sqlite',
    )
    expect(sql).toBe(
      'CREATE TABLE users (id INTEGER, email TEXT UNIQUE)\n\n' +
        'CREATE INDEX idx_email ON users(email DESC);',
    )
    expect(sql).not.toContain('sqlite_autoindex')
  })

  it('keeps native triggers after the table and its indexes', () => {
    const sql = buildTableDDL(
      {
        ...base,
        triggers: [
          {
            name: 'users_audit',
            createScript:
              'CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END',
          },
        ],
      },
      'sqlite',
    )

    expect(sql).toEndWith(
      'CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END;',
    )
  })

  it('places PostgreSQL policies and replica identity after indexes and before triggers', () => {
    const sql = buildTableDDL(
      {
        ...base,
        schema: 'inventory',
        comment: 'Inventory users',
        postgresAccess: {
          owner: 'data owner',
          tableGrants: [
            {
              grantor: 'data owner',
              grantee: 'reader',
              privilege: 'SELECT',
              grantable: false,
            },
          ],
        },
        columns: base.columns.map((column) => {
          if (column.name === 'org_id') return { ...column, comment: 'Owning organization' }
          if (column.name !== 'id') return column
          return {
            ...column,
            ownedSequence: {
              schema: 'inventory',
              name: 'users_id_seq',
              dataType: 'bigint',
              start: '1',
              increment: '1',
              minValue: '1',
              maxValue: '9223372036854775807',
              cache: '1',
              cycle: false,
              comment: 'Generated user identifiers',
              postgresAccess: {
                owner: 'data owner',
                grants: [
                  {
                    grantor: 'data owner',
                    grantee: 'reader',
                    privilege: 'USAGE' as const,
                    grantable: false,
                  },
                ],
              },
            },
          }
        }),
        indexes: [
          {
            name: 'users_replica_key',
            columns: ['id'],
            unique: true,
          },
        ],
        postgresRowSecurity: {
          enabled: true,
          forced: false,
          policies: [
            {
              name: 'tenant visibility',
              command: 'SELECT',
              permissive: true,
              roles: ['PUBLIC'],
              using: 'org_id = 42',
            },
          ],
        },
        postgresReplicaIdentity: {
          mode: 'INDEX',
          index: 'users_replica_key',
        },
        postgresClusteredIndex: 'users_replica_key',
        postgresExtendedStatistics: [
          {
            schema: 'metrics',
            name: 'users_org_name_stats',
            createScript:
              'CREATE STATISTICS metrics.users_org_name_stats (dependencies) ' +
              'ON org_id, name FROM inventory.users',
            owner: 'stats owner',
            statisticsTarget: 400,
          },
        ],
        rules: [
          {
            name: 'notify_update',
            createScript:
              'CREATE RULE notify_update AS ON UPDATE TO inventory.users DO ALSO NOTIFY audit',
          },
        ],
        triggers: [
          {
            name: 'users_audit',
            createScript:
              'CREATE TRIGGER users_audit AFTER INSERT ON inventory.users ' +
              'FOR EACH ROW EXECUTE FUNCTION audit_user()',
          },
        ],
      },
      'postgres',
    )

    const relationCommentAt = sql.indexOf(
      'COMMENT ON TABLE "inventory"."users" IS E\'Inventory users\'',
    )
    const columnCommentAt = sql.indexOf(
      'COMMENT ON COLUMN "inventory"."users"."org_id" IS E\'Owning organization\'',
    )
    const indexAt = sql.indexOf('CREATE UNIQUE INDEX "users_replica_key"')
    const policyAt = sql.indexOf('CREATE POLICY "tenant visibility"')
    const clusterAt = sql.indexOf('CLUSTER ON "users_replica_key"')
    const replicaAt = sql.indexOf('REPLICA IDENTITY USING INDEX "users_replica_key"')
    const ruleAt = sql.indexOf('CREATE RULE notify_update')
    const triggerAt = sql.indexOf('CREATE TRIGGER users_audit')
    const ownerAt = sql.indexOf('ALTER TABLE "inventory"."users" OWNER TO "data owner"')
    const grantAt = sql.indexOf('GRANT SELECT ON TABLE "inventory"."users" TO "reader"')
    const statisticsAt = sql.indexOf(
      'CREATE STATISTICS metrics.users_org_name_stats (dependencies) ' +
        'ON org_id, name FROM inventory.users',
    )
    const sequenceCommentAt = sql.indexOf(
      'COMMENT ON SEQUENCE "inventory"."users_id_seq" IS E\'Generated user identifiers\'',
    )
    const sequenceGrantAt = sql.indexOf(
      'GRANT USAGE ON SEQUENCE "inventory"."users_id_seq" TO "reader"',
    )
    expect(relationCommentAt).toBeGreaterThan(0)
    expect(columnCommentAt).toBeGreaterThan(relationCommentAt)
    expect(indexAt).toBeGreaterThan(columnCommentAt)
    expect(policyAt).toBeGreaterThan(indexAt)
    expect(clusterAt).toBeGreaterThan(policyAt)
    expect(replicaAt).toBeGreaterThan(clusterAt)
    expect(ruleAt).toBeGreaterThan(replicaAt)
    expect(triggerAt).toBeGreaterThan(ruleAt)
    expect(ownerAt).toBeGreaterThan(triggerAt)
    expect(grantAt).toBeGreaterThan(ownerAt)
    expect(statisticsAt).toBeGreaterThan(grantAt)
    expect(sql).toContain(
      'ALTER STATISTICS "metrics"."users_org_name_stats" OWNER TO "stats owner"',
    )
    expect(sequenceCommentAt).toBeGreaterThan(statisticsAt)
    expect(sequenceGrantAt).toBeGreaterThan(sequenceCommentAt)
  })

  it('reconstructs a CREATE with inline single PK and NOT NULL', () => {
    const sql = buildTableDDL(base, 'sqlite')
    // Names are quoted; `dataType` is engine text and is NOT.
    expect(sql).toContain('CREATE TABLE "users" (')
    expect(sql).toContain('"id" INTEGER PRIMARY KEY NOT NULL')
    expect(sql).toContain('"name" TEXT NOT NULL')
    expect(sql).toContain('"org_id" INTEGER')
  })

  it('emits a table-level PRIMARY KEY for a composite key', () => {
    const sql = buildTableDDL(
      {
        ...base,
        primaryKey: ['a', 'b'],
        columns: [
          { name: 'a', dataType: 'INT', nullable: false, pk: true },
          { name: 'b', dataType: 'INT', nullable: false, pk: true },
        ],
      },
      'sqlite',
    )
    expect(sql).toContain('PRIMARY KEY ("a", "b")')
    expect(sql).not.toContain('a INT PRIMARY KEY')
  })

  it('renders foreign keys and a default value', () => {
    const sql = buildTableDDL(
      {
        ...base,
        columns: [
          { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
          { name: 'status', dataType: 'TEXT', nullable: true, pk: false, defaultValue: "'new'" },
          { name: 'org_id', dataType: 'INTEGER', nullable: true, pk: false },
        ],
        foreignKeys: [{ columns: ['org_id'], refTable: 'orgs', refColumns: ['id'] }],
      },
      'sqlite',
    )
    expect(sql).toContain(`"status" TEXT DEFAULT 'new'`)
    expect(sql).toContain('FOREIGN KEY ("org_id") REFERENCES "orgs"("id")')
  })

  it('does not fabricate a defining SELECT for a view', () => {
    expect(buildTableDDL({ ...base, schema: 'reporting', type: 'view' }, 'postgres')).toBe(
      '-- Definition unavailable for view "reporting"."users".',
    )
  })

  it('appends explicit (non-PK) indexes and skips the PK index', () => {
    const sql = buildTableDDL(
      {
        ...base,
        indexes: [
          { name: 'pk_users', columns: ['id'], unique: true, primary: true },
          { name: 'idx_name', columns: ['name'], unique: false },
          { name: 'uq_org', columns: ['org_id'], unique: true },
        ],
      },
      'sqlite',
    )
    expect(sql).toContain('CREATE INDEX "idx_name" ON "users" ("name");')
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_org" ON "users" ("org_id");')
    expect(sql).not.toContain('pk_users')
  })
})

describe('buildSchemaDump', () => {
  it('concatenates each table under a typed header, in order', () => {
    const dump = buildSchemaDump(
      [
        { ...base, createScript: 'CREATE TABLE users (id INTEGER)' },
        {
          ...base,
          name: 'v_active',
          type: 'view',
          createScript: 'CREATE VIEW v_active AS SELECT 1',
        },
      ],
      'sqlite',
    )
    expect(dump).toBe(
      '-- Table: users\nCREATE TABLE users (id INTEGER)\n\n' +
        '-- View: v_active\nCREATE VIEW v_active AS SELECT 1',
    )
  })

  it('is empty for no tables', () => {
    expect(buildSchemaDump([], 'sqlite')).toBe('')
  })

  // Names come straight out of a foreign database's introspection — reserved words,
  // spaces, quotes, unicode are all ordinary there. This renderer feeds a HUMAN a dump
  // meant to be runnable and the MODEL the `localix://resource/db/` resource it reads as the schema's
  // ground truth, so an unparseable CREATE is wrong in both directions at once.
  it('quotes names that would otherwise not parse', () => {
    const sql = buildTableDDL(
      {
        ...base,
        name: 'order',
        primaryKey: ['My Id'],
        columns: [{ name: 'My Id', dataType: 'INTEGER', nullable: false, pk: true }],
      },
      'sqlite',
    )
    expect(sql).toContain('CREATE TABLE "order" (')
    expect(sql).toContain('"My Id" INTEGER PRIMARY KEY NOT NULL')
  })

  it('escapes the dialect closing character inside a name', () => {
    const sql = buildTableDDL({ ...base, name: 'we"ird' }, 'sqlite')
    expect(sql).toContain('CREATE TABLE "we""ird" (')
  })

  it('quotes per DIALECT, not one style for all — the reverse direction', () => {
    // A single quoting style would be as broken as none: backticks are a syntax error in
    // postgres, double quotes mean a string literal in mysql.
    expect(buildTableDDL(base, 'mysql')).toContain('CREATE TABLE `users` (')
    expect(buildTableDDL(base, 'mssql')).toContain('CREATE TABLE [users] (')
    expect(buildTableDDL(base, 'postgres')).toContain('CREATE TABLE "users" (')
  })

  it('qualifies reconstructed tables, indexes and foreign-key targets', () => {
    const sql = buildTableDDL(
      {
        ...base,
        schema: 'reporting',
        foreignKeys: [
          {
            columns: ['org_id'],
            refSchema: 'identity',
            refTable: 'orgs',
            refColumns: ['id'],
          },
        ],
        indexes: [{ name: 'idx_org', columns: ['org_id'], unique: false }],
      },
      'postgres',
    )
    expect(sql).toContain('CREATE TABLE "reporting"."users" (')
    expect(sql).toContain('REFERENCES "identity"."orgs"("id")')
    expect(sql).toContain('CREATE INDEX "idx_org" ON "reporting"."users" ("org_id");')
  })

  it('leaves the engine createScript verbatim — no quoting applied', () => {
    // The other over-reach guard: sqlite hands back its own CREATE, which is already
    // correct; re-rendering it would be this module inventing a script it was given.
    expect(
      buildTableDDL({ ...base, createScript: 'CREATE TABLE users (id INTEGER)' }, 'postgres'),
    ).toBe('CREATE TABLE users (id INTEGER)')
  })
})
