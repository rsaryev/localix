import { describe, expect, it } from 'bun:test'
import { createDbSchemaTool, type DbSchemaPort, type DbSchemaTable } from './db-schema'

const conn = (
  over: Partial<{
    id: string
    name: string
    dialect: string
    connected: boolean
    readonly: boolean
  }> = {},
) => ({
  id: 'c1',
  name: 'app',
  dialect: 'postgres',
  connected: true,
  readonly: false,
  ...over,
})

function port(over: Partial<DbSchemaPort> = {}): DbSchemaPort {
  return {
    listConnections: async () => [conn()],
    schemas: async () => ({
      public: [
        { name: 'users', type: 'table' },
        { name: 'active_users', type: 'view' },
      ],
    }),
    tableSchema: async (): Promise<DbSchemaTable> => ({
      schema: 'public',
      name: 'users',
      type: 'table',
      comment: 'Application users',
      postgresAccess: {
        owner: 'data owner',
        tableGrants: [
          {
            grantor: 'data owner',
            grantee: 'reader',
            privilege: 'SELECT',
            grantable: true,
          },
        ],
      },
      postgresExtendedStatistics: [
        {
          schema: 'metrics',
          name: 'users_email_stats',
          createScript:
            'CREATE STATISTICS metrics.users_email_stats ON lower(email) FROM public.users',
          owner: 'stats owner',
          statisticsTarget: 275,
          comment: 'Email selectivity',
        },
      ],
      columns: [
        {
          name: 'id',
          dataType: 'integer',
          nullable: false,
          pk: true,
          comment: 'Stable user identifier',
          ownedSequence: {
            schema: 'public',
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
                  privilege: 'USAGE',
                  grantable: false,
                },
              ],
            },
          },
        },
        {
          name: 'email',
          dataType: 'text',
          nullable: false,
          pk: false,
          generated: {
            expression: 'lower(raw_email)',
            storage: 'STORED',
          },
        },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'users_org_fkey',
          columns: ['org_id'],
          refSchema: 'identity',
          refTable: 'orgs',
          refColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          deferrable: true,
          initiallyDeferred: true,
          validated: false,
          enforced: false,
        },
      ],
      checkConstraints: [
        {
          name: 'users_email_check',
          expression: "email <> ''",
          noInherit: true,
          validated: false,
        },
      ],
      keyConstraints: [
        {
          name: 'users_email_key',
          type: 'UNIQUE',
          columns: ['email'],
          nullsNotDistinct: true,
          deferrable: true,
          initiallyDeferred: true,
        },
      ],
      exclusionConstraints: [
        {
          name: 'users_room_during_excl',
          definition: 'EXCLUDE USING gist (room WITH =, during WITH &&)',
        },
      ],
      indexes: [{ name: 'users_email_idx', columns: ['email'], unique: true }],
      approxRows: 42,
    }),
    ...over,
  }
}

const run = (p: DbSchemaPort, input: { connection_id?: string; table?: string; schema?: string }) =>
  createDbSchemaTool({ userId: 'u', port: p }).execute('t', input)

describe('db_schema tool', () => {
  it('lists connections when called with no arguments', async () => {
    const r = await run(port(), {})
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('app [postgres]')
    expect(r.content).toContain('id: c1')
  })

  it('answers an empty roster when nothing is connected — the call itself was right', async () => {
    const r = await run(port({ listConnections: async () => [] }), {})
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('No database is connected')
  })

  it('lists a connection schema tree grouped by schema with counts', async () => {
    const r = await run(port(), { connection_id: 'c1' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('public (2)')
    expect(r.content).toContain('users')
    expect(r.content).toContain('active_users (view)')
  })

  it('describes a table: columns, PK, FK and indexes', async () => {
    const r = await run(port(), { connection_id: 'c1', table: 'users' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('id integer PK')
    expect(r.content).toContain('Comment:\n  Application users')
    expect(r.content).toContain('id integer PK NOT NULL · OWNED SEQUENCE public.users_id_seq')
    expect(r.content).toContain('COMMENT Stable user identifier')
    expect(r.content).toContain(
      'OWNED SEQUENCE public.users_id_seq · COMMENT Generated user identifiers · ' +
        'OWNER data owner · ACL USAGE TO reader BY data owner',
    )
    expect(r.content).toContain(
      'PostgreSQL access:\n  OWNER data owner · TABLE ACL SELECT* TO reader BY data owner',
    )
    expect(r.content).toContain(
      'Extended statistics:\n  metrics.users_email_stats · OWNER stats owner · TARGET 275 · ' +
        'COMMENT Email selectivity · CREATE STATISTICS metrics.users_email_stats',
    )
    expect(r.content).toContain('email text NOT NULL')
    expect(r.content).toContain('GENERATED ALWAYS AS (lower(raw_email)) STORED')
    expect(r.content).toContain('users_org_fkey: (org_id) → identity.orgs(id)')
    expect(r.content).toContain('ON DELETE CASCADE · ON UPDATE NO ACTION')
    expect(r.content).toContain('DEFERRABLE INITIALLY DEFERRED · NOT VALID · NOT ENFORCED')
    expect(r.content).toContain("CHECK users_email_check: email <> '' · NO INHERIT · NOT VALID")
    expect(r.content).toContain(
      'UNIQUE users_email_key: (email) · NULLS NOT DISTINCT · DEFERRABLE INITIALLY DEFERRED',
    )
    expect(r.content).toContain(
      'EXCLUSION users_room_during_excl: EXCLUDE USING gist (room WITH =, during WITH &&)',
    )
    expect(r.content).toContain('users_email_idx UNIQUE')
    expect(r.content).toContain('~42 rows')
  })

  it('reports a schemaless (non-SQL) table has no column metadata', async () => {
    const r = await run(
      port({
        listConnections: async () => [conn({ dialect: 'mongodb' })],
        tableSchema: async () => ({
          name: 'users',
          type: 'table',
          columns: [],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }),
      }),
      { connection_id: 'c1', table: 'users' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('no column metadata')
    // The hint names the ONE tool's action, not a tool that no longer exists.
    expect(r.content).toContain('action="browse"')
  })

  it('describes SQL Server temporal boundary generation without expanding hidden metadata', async () => {
    const r = await run(
      port({
        listConnections: async () => [conn({ dialect: 'mssql' })],
        tableSchema: async () => ({
          schema: 'sales',
          name: 'orders',
          type: 'table',
          columns: [
            {
              name: 'valid_from',
              dataType: 'datetime2(7)',
              nullable: false,
              pk: false,
              sqlServerGeneratedAlways: 'ROW START',
              sqlServerHidden: true,
            },
          ],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }),
      }),
      { connection_id: 'c1', schema: 'sales', table: 'orders' },
    )

    expect(r.content).toContain('GENERATED ALWAYS AS ROW START HIDDEN')
  })

  it('describes a PostgreSQL typed-table dependency', async () => {
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'archive',
          name: 'assets',
          type: 'table',
          columns: [{ name: 'id', dataType: 'bigint', nullable: true, pk: false }],
          primaryKey: [],
          foreignKeys: [],
          postgresOfType: {
            schema: 'inventory',
            name: 'asset_type',
          },
          indexes: [],
        }),
      }),
      { connection_id: 'c1', table: 'assets' },
    )

    expect(r.content).toContain('Typed table:\n  OF inventory.asset_type')
  })

  it('describes PostgreSQL foreign-table and column FDW options', async () => {
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'archive',
          name: 'assets',
          type: 'table',
          columns: [
            {
              name: 'id',
              dataType: 'bigint',
              nullable: false,
              pk: false,
              postgresForeignOptions: [{ name: 'column_name', value: 'asset_id' }],
            },
          ],
          primaryKey: [],
          foreignKeys: [],
          postgresForeign: {
            server: 'warehouse',
            options: [
              { name: 'schema_name', value: 'inventory' },
              { name: 'table_name', value: 'assets' },
            ],
          },
          indexes: [],
        }),
      }),
      { connection_id: 'c1', table: 'assets' },
    )

    expect(r.content).toContain('id bigint NOT NULL · FDW OPTIONS (column_name=asset_id)')
    expect(r.content).toContain(
      'Foreign table:\n  SERVER warehouse · OPTIONS (schema_name=inventory, table_name=assets)',
    )
  })

  it('describes PostgreSQL column storage and planner properties', async () => {
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'inventory',
          name: 'assets',
          type: 'table',
          columns: [
            {
              name: 'payload',
              dataType: 'text',
              nullable: true,
              pk: false,
              postgresCollation: { schema: 'pg_catalog', name: 'C' },
              postgresStorage: 'EXTERNAL',
              postgresCompression: 'pglz',
              postgresStatistics: 777,
              postgresAttributeOptions: [{ name: 'n_distinct', value: '0.25' }],
            },
          ],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }),
      }),
      { connection_id: 'c1', table: 'assets' },
    )

    expect(r.content).toContain(
      'payload text · COLLATE pg_catalog.C · STORAGE EXTERNAL · COMPRESSION pglz · ' +
        'STATISTICS 777 · WITH (n_distinct=0.25)',
    )
  })

  it('describes PostgreSQL row security and replica identity', async () => {
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'inventory',
          name: 'assets',
          type: 'table',
          columns: [{ name: 'tenant_id', dataType: 'text', nullable: false, pk: false }],
          primaryKey: [],
          foreignKeys: [],
          postgresRowSecurity: {
            enabled: true,
            forced: true,
            policies: [
              {
                name: 'tenant visibility',
                command: 'SELECT',
                permissive: false,
                roles: ['analyst'],
                using: 'tenant_id = CURRENT_USER',
              },
            ],
          },
          postgresReplicaIdentity: {
            mode: 'INDEX',
            index: 'assets_replica_key',
          },
          postgresClusteredIndex: 'assets_cluster_key',
          indexes: [],
        }),
      }),
      { connection_id: 'c1', table: 'assets' },
    )

    expect(r.content).toContain(
      'Row security:\n' +
        '  ENABLED · FORCED\n' +
        '  POLICY tenant visibility · RESTRICTIVE · FOR SELECT · TO analyst · ' +
        'USING (tenant_id = CURRENT_USER)',
    )
    expect(r.content).toContain('Replica identity:\n  USING INDEX assets_replica_key')
    expect(r.content).toContain('Clustered index:\n  assets_cluster_key')
  })

  it('describes PostgreSQL rewrite rules and their firing state', async () => {
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'inventory',
          name: 'assets',
          type: 'table',
          columns: [{ name: 'id', dataType: 'bigint', nullable: false, pk: false }],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
          rules: [
            {
              name: 'notify_update',
              createScript:
                'CREATE RULE notify_update AS ON UPDATE TO inventory.assets DO ALSO NOTIFY audit',
              postCreateScripts: [
                'ALTER TABLE ONLY inventory.assets ENABLE REPLICA RULE notify_update',
              ],
            },
          ],
        }),
      }),
      { connection_id: 'c1', table: 'assets' },
    )

    expect(r.content).toContain(
      'Rules:\n' +
        '  notify_update (native definition; after: ' +
        'ALTER TABLE ONLY inventory.assets ENABLE REPLICA RULE notify_update)',
    )
  })

  it('shows a bounded native definition when normalized index fields are incomplete', async () => {
    const native =
      'CREATE UNIQUE INDEX users_active_email_idx ON users (lower(email)) ' +
      `WHERE deleted_at IS NULL /* ${'x'.repeat(600)} */`
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'public',
          name: 'users',
          type: 'table',
          columns: [
            {
              name: 'email',
              dataType: 'text',
              nullable: false,
              pk: false,
              postgresNotNull: {
                name: 'users_email_not_null',
                validated: false,
                noInherit: true,
              },
            },
          ],
          primaryKey: [],
          foreignKeys: [],
          postgresPartitionBy: 'RANGE (created_at, lower(region) text_pattern_ops)',
          postgresPartition: {
            parentSchema: 'archive',
            parentTable: 'users',
            bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
          },
          postgresInheritance: {
            parents: [
              { schema: 'audit', table: 'events' },
              { schema: 'crm', table: 'customers' },
            ],
            localColumns: ['email'],
          },
          postgresRelation: {
            persistence: 'UNLOGGED',
            accessMethod: 'heap',
            storageParameters: ['fillfactor=70'],
            tablespace: 'fast space',
          },
          indexes: [
            {
              name: 'users_active_email_idx',
              columns: [],
              unique: true,
              createScript: native,
              createScriptOnly: true,
            },
          ],
        }),
      }),
      { connection_id: 'c1', table: 'users' },
    )

    expect(r.content).toContain('Native definition: CREATE UNIQUE INDEX')
    expect(r.content).toContain(
      'Partitioning:\n' +
        "  PARTITION OF archive.users FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')\n" +
        '  PARTITION BY RANGE (created_at, lower(region) text_pattern_ops)',
    )
    expect(r.content).toContain('Inheritance:\n  INHERITS (audit.events, crm.customers)')
    expect(r.content).toContain(
      'email text NOT NULL · CONSTRAINT users_email_not_null · NO INHERIT · NOT VALID',
    )
    expect(r.content).toContain(
      'PostgreSQL relation:\n  UNLOGGED · USING heap · WITH (fillfactor=70) · TABLESPACE fast space',
    )
    expect(r.content).toContain('…')
    expect(r.content).not.toContain(native)
  })

  it('shows bounded native trigger definitions', async () => {
    const native =
      'CREATE TRIGGER users_audit AFTER UPDATE ON users BEGIN ' + `SELECT '${'x'.repeat(600)}'; END`
    const r = await run(
      port({
        tableSchema: async () => ({
          schema: 'public',
          name: 'users',
          type: 'table',
          columns: [{ name: 'id', dataType: 'integer', nullable: false, pk: true }],
          primaryKey: ['id'],
          foreignKeys: [],
          indexes: [],
          triggers: [
            {
              name: 'users_audit',
              createScript: native,
              preCreateScripts: ['SET SESSION sql_mode = STRICT_ALL_TABLES'],
              postCreateScripts: [
                'ALTER TABLE ONLY "public"."users" DISABLE TRIGGER "users_audit"',
              ],
            },
            {
              name: 'encrypted_audit',
              createScript: '-- Definition unavailable for trigger encrypted_audit',
              definitionUnavailable: true,
            },
          ],
        }),
      }),
      { connection_id: 'c1', table: 'users' },
    )

    expect(r.content).toContain('Triggers:')
    expect(r.content).toContain('users_audit')
    expect(r.content).toContain('Pre-create context: SET SESSION sql_mode = STRICT_ALL_TABLES')
    expect(r.content).toContain('Native definition: CREATE TRIGGER')
    expect(r.content).toContain(
      'Post-create statement: ALTER TABLE ONLY "public"."users" DISABLE TRIGGER "users_audit"',
    )
    expect(r.content).toContain('encrypted_audit\n    Definition unavailable')
    expect(r.content).toContain('…')
    expect(r.content).not.toContain(native)
  })

  it('errors on an unknown connection id', async () => {
    const r = await run(port(), { connection_id: 'nope' })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('No connected database with id')
  })

  it('reports an empty database', async () => {
    const r = await run(port({ schemas: async () => ({}) }), { connection_id: 'c1' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('no tables/objects yet')
  })
})
