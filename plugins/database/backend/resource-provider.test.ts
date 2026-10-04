import { describe, expect, it } from 'bun:test'
import { createDatabaseResourceProvider, type ResourceDbService } from './resource-provider'
import type { DbConnectionInfo } from './contracts'
import type { DbSchemas, DbTableSchema } from './drivers/port'

const CONN: DbConnectionInfo = {
  id: 'c1',
  name: 'main.db',
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  flags: {
    dialect: 'sqlite',
    kind: 'sql',
    supportsMultipleSchemas: false,
    supportsReturning: false,
    supportsCancel: false,
    defaultSchema: 'main',
  },
  createdAt: 0,
}

const PG_CONN: DbConnectionInfo = {
  id: 'pg1',
  name: 'app',
  dialect: 'postgres',
  connected: true,
  readonly: false,
  flags: {
    dialect: 'postgres',
    kind: 'sql',
    supportsMultipleSchemas: true,
    supportsReturning: true,
    supportsCancel: true,
    defaultSchema: 'public',
  },
  createdAt: 0,
}

const ORDERS: DbTableSchema = {
  schema: 'main',
  name: 'orders',
  type: 'table',
  columns: [
    { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
    { name: 'user_id', dataType: 'INTEGER', nullable: false, pk: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [
    {
      name: 'orders_user_fkey',
      columns: ['user_id'],
      refSchema: 'identity',
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    },
  ],
  indexes: [],
  createScript: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL)',
}

function fakeService(overrides: Partial<ResourceDbService> = {}): ResourceDbService {
  return {
    async list() {
      return [CONN, PG_CONN]
    },
    async schemas(_userId, id) {
      if (id === 'c1')
        return {
          schemas: {
            main: [
              { name: 'orders', type: 'table' },
              { name: 'v_recent', type: 'view' },
            ],
          } as DbSchemas,
        }
      if (id === 'pg1')
        return { schemas: { public: [{ name: 'orders', type: 'table' }], audit: [] } as DbSchemas }
      return null
    },
    async tableSchema() {
      return { table: ORDERS }
    },
    async recentQueries() {
      return []
    },
    ...overrides,
  }
}

describe('database resource provider — listChildren', () => {
  it('roots are the connections', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const roots = await p.listChildren('u', null)
    expect(roots.map((n) => n.uri)).toEqual([
      'localix://resource/db/c1',
      'localix://resource/db/pg1',
    ])
    expect(roots[0].icon).toBe('connection')
    expect(roots[0].hasChildren).toBe(true)
  })

  it('single-schema engine skips the schema level, listing tables directly', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const nodes = await p.listChildren('u', 'localix://resource/db/c1')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/db/c1/_/main/orders',
      'localix://resource/db/c1/_/main/v_recent',
    ])
  })

  it('multi-schema engine exposes the schema level', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const nodes = await p.listChildren('u', 'localix://resource/db/pg1')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/db/pg1/_/public',
      'localix://resource/db/pg1/_/audit',
    ])
    const tables = await p.listChildren('u', 'localix://resource/db/pg1/_/public')
    expect(tables.map((n) => n.uri)).toEqual(['localix://resource/db/pg1/_/public/orders'])
  })

  it('distinguishes own prototype-named schemas from inherited object members', async () => {
    const inherited = createDatabaseResourceProvider(fakeService())
    expect(await inherited.listChildren('u', 'localix://resource/db/c1/_/constructor')).toEqual([])

    const owned = createDatabaseResourceProvider(
      fakeService({
        schemas: async () => ({
          schemas: {
            ['__proto__']: [{ name: 'events', type: 'table' }],
          } as DbSchemas,
        }),
      }),
    )
    const nodes = await owned.listChildren('u', 'localix://resource/db/c1')
    expect(nodes.map((node) => node.uri)).toEqual(['localix://resource/db/c1/_/__proto__/events'])
  })

  it('table children are its columns (leaves)', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const cols = await p.listChildren('u', 'localix://resource/db/c1/_/main/orders')
    expect(cols.map((n) => n.label)).toEqual(['id', 'user_id'])
    expect(cols.every((n) => !n.hasChildren)).toBe(true)
  })
})

describe('database resource provider — expand', () => {
  it('table expands to DDL + approx row count + FK summary', async () => {
    // The count is the engine's cheap approxRows stat — never a COUNT(*) query.
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: { ...ORDERS, approxRows: 42 } }) }),
    )
    const exp = await p.expand('u', 'localix://resource/db/c1/_/main/orders')
    expect(exp.ok).toBe(true)
    expect(exp.language).toBe('sql')
    expect(exp.content).toContain('~42 rows')
    expect(exp.content).toContain('CREATE TABLE orders')
    expect(exp.content).toContain(
      'FK orders_user_fkey: (user_id) → identity.users(id) · ON DELETE CASCADE · ON UPDATE NO ACTION',
    )
  })

  it('includes explicit indexes and native triggers so model context matches the schema browser', async () => {
    const p = createDatabaseResourceProvider(
      fakeService({
        tableSchema: async () => ({
          table: {
            ...ORDERS,
            schema: 'public',
            comment: 'Orders placed by customers',
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
            columns: ORDERS.columns.map((column) =>
              column.name === 'user_id' ? { ...column, comment: 'Owning user identifier' } : column,
            ),
            indexes: [
              {
                name: 'idx_orders_user',
                columns: ['user_id'],
                unique: false,
                primary: false,
              },
            ],
            triggers: [
              {
                name: 'orders_audit',
                createScript:
                  'CREATE TRIGGER orders_audit AFTER INSERT ON orders BEGIN SELECT NEW.id; END',
              },
            ],
          },
        }),
      }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/public/orders')

    expect(exp.ok).toBe(true)
    expect(exp.content).toContain(
      'COMMENT ON TABLE "public"."orders" IS E\'Orders placed by customers\';',
    )
    expect(exp.content).toContain(
      'COMMENT ON COLUMN "public"."orders"."user_id" IS E\'Owning user identifier\';',
    )
    expect(exp.content).toContain('CREATE INDEX "idx_orders_user"')
    expect(exp.content).toContain(
      'CREATE TRIGGER orders_audit AFTER INSERT ON orders BEGIN SELECT NEW.id; END;',
    )
    expect(exp.content).toContain('ALTER TABLE "public"."orders" OWNER TO "data owner";')
    expect(exp.content).toContain('GRANT SELECT ON TABLE "public"."orders" TO "reader";')
  })

  it('keeps owned-sequence comments and ACLs after table ownership', async () => {
    const table: DbTableSchema = {
      ...ORDERS,
      schema: 'public',
      createScript: undefined,
      postgresAccess: {
        owner: 'data owner',
      },
      postgresExtendedStatistics: [
        {
          schema: 'metrics',
          name: 'orders_shape',
          createScript:
            'CREATE STATISTICS metrics.orders_shape (dependencies) ' +
            'ON user_id, status FROM public.orders',
          owner: 'stats owner',
          statisticsTarget: 250,
          comment: 'Order planner hints',
        },
      ],
      columns: ORDERS.columns.map((column) =>
        column.name === 'id'
          ? {
              ...column,
              ownedSequence: {
                schema: 'public',
                name: 'orders_id_seq',
                dataType: 'bigint',
                start: '1',
                increment: '1',
                minValue: '1',
                maxValue: '9223372036854775807',
                cache: '1',
                cycle: false,
                comment: 'Generated order identifiers',
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
            }
          : column,
      ),
    }
    const p = createDatabaseResourceProvider(fakeService({ tableSchema: async () => ({ table }) }))

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/public/orders')

    expect(exp.ok).toBe(true)
    const ownerAt = exp.content!.indexOf('ALTER TABLE "public"."orders" OWNER TO "data owner";')
    const commentAt = exp.content!.indexOf(
      'COMMENT ON SEQUENCE "public"."orders_id_seq" IS E\'Generated order identifiers\';',
    )
    const statisticsAt = exp.content!.indexOf(
      'CREATE STATISTICS metrics.orders_shape (dependencies) ' +
        'ON user_id, status FROM public.orders;',
    )
    const grantAt = exp.content!.indexOf(
      'GRANT USAGE ON SEQUENCE "public"."orders_id_seq" TO "reader";',
    )
    expect(exp.content).toContain('CREATE SEQUENCE "public"."orders_id_seq"')
    expect(ownerAt).toBeGreaterThan(0)
    expect(statisticsAt).toBeGreaterThan(ownerAt)
    expect(exp.content).toContain('ALTER STATISTICS "metrics"."orders_shape" SET STATISTICS 250;')
    expect(exp.content).toContain(
      'COMMENT ON STATISTICS "metrics"."orders_shape" IS E\'Order planner hints\';',
    )
    expect(commentAt).toBeGreaterThan(statisticsAt)
    expect(grantAt).toBeGreaterThan(commentAt)
  })

  it('compacts a very wide table under the provider quota without losing key structure', async () => {
    const wide: DbTableSchema = {
      ...ORDERS,
      schema: 'public',
      comment: 'Orders placed by customers',
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
      postgresExtendedStatistics: [
        {
          schema: 'metrics',
          name: 'orders_user_region_stats',
          createScript:
            'CREATE STATISTICS metrics.orders_user_region_stats (dependencies, mcv) ' +
            'ON user_id, lower(region) FROM public.orders',
          owner: 'stats owner',
          statisticsTarget: 500,
        },
      ],
      createScript: undefined,
      checkConstraints: [
        {
          name: 'orders_user_id_check',
          expression: 'user_id > 0',
          validated: false,
        },
      ],
      keyConstraints: [
        {
          name: 'orders_user_id_key',
          type: 'UNIQUE',
          columns: ['user_id'],
          nullsNotDistinct: true,
        },
      ],
      exclusionConstraints: [
        {
          name: 'orders_booking_excl',
          definition: 'EXCLUDE USING gist (room WITH =, during WITH &&)',
        },
      ],
      postgresPartitionBy: 'RANGE (created_at, lower(region) text_pattern_ops)',
      columns: [
        ...ORDERS.columns,
        ...Array.from({ length: 500 }, (_, index) => ({
          name: `περιγραφή_${index}`,
          dataType: `varchar(255) ${'λ'.repeat(40)}`,
          nullable: index % 2 === 0,
          pk: false,
          ...(index === 499
            ? {
                comment: 'Normalized source text',
                generated: {
                  expression: 'lower(source_text)',
                  storage: 'STORED' as const,
                },
              }
            : {}),
        })),
      ],
      indexes: [
        {
          name: 'idx_orders_user',
          columns: ['user_id'],
          unique: false,
          primary: false,
        },
      ],
      triggers: [
        {
          name: 'orders_audit',
          createScript: 'CREATE TRIGGER orders_audit AFTER INSERT ON orders BEGIN SELECT 1; END',
          preCreateScripts: ['SET SESSION sql_mode = STRICT_ALL_TABLES'],
          postCreateScripts: [
            'ALTER TABLE ONLY "public"."orders" ENABLE REPLICA TRIGGER "orders_audit"',
          ],
        },
        {
          name: 'encrypted_audit',
          createScript: '-- Definition unavailable for trigger encrypted_audit',
          definitionUnavailable: true,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: wide }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/public/orders')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('Wide schema compacted from 502 columns')
    expect(exp.content).toContain('Primary key: (id)')
    expect(exp.content).toContain('Comment: Orders placed by customers')
    expect(exp.content).toContain(
      'PostgreSQL access: OWNER data owner · TABLE ACL SELECT TO reader BY data owner',
    )
    expect(exp.content).toContain(
      'Extended statistics:\n- metrics.orders_user_region_stats · OWNER stats owner · TARGET 500',
    )
    expect(exp.content).toContain(
      'FK orders_user_fkey: (user_id) → identity.users(id) · ON DELETE CASCADE · ON UPDATE NO ACTION',
    )
    expect(exp.content).toContain('CHECK orders_user_id_check: user_id > 0 · NOT VALID')
    expect(exp.content).toContain('UNIQUE orders_user_id_key: (user_id) · NULLS NOT DISTINCT')
    expect(exp.content).toContain(
      'EXCLUSION orders_booking_excl: EXCLUDE USING gist (room WITH =, during WITH &&)',
    )
    expect(exp.content).toContain(
      'Partitioning: PARTITION BY RANGE (created_at, lower(region) text_pattern_ops)',
    )
    expect(exp.content).toContain('idx_orders_user')
    expect(exp.content).toContain('orders_audit (native definition; before:')
    expect(exp.content).toContain('SET SESSION sql_mode = STRICT_ALL_TABLES')
    expect(exp.content).toContain('ENABLE REPLICA TRIGGER "orders_audit"')
    expect(exp.content).toContain('encrypted_audit (definition unavailable)')
    expect(exp.content).toContain('GENERATED ALWAYS AS (lower(source_text)) STORED')
    expect(exp.content).toContain('COMMENT Normalized source text')
    expect(exp.content).toContain('schema entries omitted')
  })

  it('keeps a child partition bound when large local DDL requires compact context', async () => {
    const child: DbTableSchema = {
      ...ORDERS,
      schema: 'public',
      name: 'orders_2026',
      createScript: undefined,
      postgresPartition: {
        parentSchema: 'archive',
        parentTable: 'orders',
        bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
      },
      triggers: [
        {
          name: 'orders_2026_audit',
          createScript:
            'CREATE TRIGGER orders_2026_audit AFTER INSERT ON orders_2026 ' +
            `EXECUTE FUNCTION audit_order('${'x'.repeat(5_000)}')`,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: child }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/public/orders_2026')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('Wide schema compacted from 2 columns')
    expect(exp.content).toContain(
      "Partitioning: PARTITION OF archive.orders FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
    )
    expect(exp.content).toContain('orders_2026_audit (native definition)')
  })

  it('keeps PostgreSQL inheritance parents in compact context', async () => {
    const inherited: DbTableSchema = {
      ...ORDERS,
      schema: 'public',
      name: 'customer_orders',
      createScript: undefined,
      postgresInheritance: {
        parents: [
          { schema: 'audit', table: 'events' },
          { schema: 'crm', table: 'customers' },
        ],
        localColumns: ['id', 'user_id'],
      },
      postgresRelation: {
        persistence: 'UNLOGGED',
        accessMethod: 'heap',
        storageParameters: ['fillfactor=70'],
        tablespace: 'fast space',
      },
      triggers: [
        {
          name: 'customer_orders_audit',
          createScript:
            'CREATE TRIGGER customer_orders_audit AFTER INSERT ON customer_orders ' +
            `EXECUTE FUNCTION audit_order('${'x'.repeat(5_000)}')`,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: inherited }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/public/customer_orders')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('Wide schema compacted from 2 columns')
    expect(exp.content).toContain('Inheritance: INHERITS (audit.events, crm.customers)')
    expect(exp.content).toContain(
      'PostgreSQL relation: UNLOGGED · USING heap · WITH (fillfactor=70) · TABLESPACE fast space',
    )
    expect(exp.content).toContain('customer_orders_audit (native definition)')
  })

  it('keeps a PostgreSQL typed-table dependency in compact context', async () => {
    const typed: DbTableSchema = {
      ...ORDERS,
      schema: 'archive',
      name: 'assets',
      createScript: undefined,
      postgresOfType: {
        schema: 'inventory',
        name: 'asset_type',
      },
      triggers: [
        {
          name: 'assets_audit',
          createScript:
            'CREATE TRIGGER assets_audit AFTER INSERT ON assets ' +
            `EXECUTE FUNCTION audit_asset('${'x'.repeat(5_000)}')`,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: typed }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/archive/assets')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('Typed table: OF inventory.asset_type')
    expect(exp.content).toContain('assets_audit (native definition)')
  })

  it('keeps PostgreSQL foreign-table and column options in compact context', async () => {
    const foreign: DbTableSchema = {
      ...ORDERS,
      schema: 'archive',
      name: 'assets',
      createScript: undefined,
      columns: ORDERS.columns.map((column, index) =>
        index === 0
          ? {
              ...column,
              postgresForeignOptions: [{ name: 'column_name', value: 'asset_id' }],
              postgresCollation: { schema: 'pg_catalog', name: 'C' },
              postgresStorage: 'EXTERNAL' as const,
              postgresCompression: 'pglz' as const,
              postgresStatistics: 777,
              postgresAttributeOptions: [{ name: 'n_distinct', value: '0.25' }],
            }
          : column,
      ),
      postgresForeign: {
        server: 'warehouse',
        options: [
          { name: 'schema_name', value: 'inventory' },
          { name: 'table_name', value: 'assets' },
        ],
      },
      triggers: [
        {
          name: 'assets_audit',
          createScript:
            'CREATE TRIGGER assets_audit AFTER INSERT ON assets ' +
            `EXECUTE FUNCTION audit_asset('${'x'.repeat(5_000)}')`,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: foreign }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/archive/assets')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('FDW OPTIONS (column_name=asset_id)')
    expect(exp.content).toContain(
      'COLLATE pg_catalog.C · STORAGE EXTERNAL · COMPRESSION pglz · ' +
        'STATISTICS 777 · WITH (n_distinct=0.25)',
    )
    expect(exp.content).toContain(
      'Foreign table: SERVER warehouse · OPTIONS (schema_name=inventory, table_name=assets)',
    )
    expect(exp.content).toContain('assets_audit (native definition)')
  })

  it('keeps PostgreSQL row security and replica identity in compact context', async () => {
    const secured: DbTableSchema = {
      ...ORDERS,
      schema: 'inventory',
      name: 'assets',
      createScript: undefined,
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
      triggers: [
        {
          name: 'assets_audit',
          createScript:
            'CREATE TRIGGER assets_audit AFTER INSERT ON assets ' +
            `EXECUTE FUNCTION audit_asset('${'x'.repeat(5_000)}')`,
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: secured }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/inventory/assets')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain('Row security: ENABLED · FORCED')
    expect(exp.content).toContain(
      'POLICY tenant visibility · RESTRICTIVE · FOR SELECT · TO analyst · ' +
        'USING (tenant_id = CURRENT_USER)',
    )
    expect(exp.content).toContain('Replica identity: USING INDEX assets_replica_key')
    expect(exp.content).toContain('Clustered index: assets_cluster_key')
    expect(exp.content).toContain('assets_audit (native definition)')
  })

  it('keeps PostgreSQL rewrite rules in compact context', async () => {
    const ruled: DbTableSchema = {
      ...ORDERS,
      schema: 'inventory',
      name: 'assets',
      createScript: undefined,
      rules: [
        {
          name: 'notify_update',
          createScript:
            'CREATE RULE notify_update AS ON UPDATE TO inventory.assets DO ALSO ' +
            `NOTIFY "${'x'.repeat(5_000)}"`,
          postCreateScripts: [
            'ALTER TABLE ONLY inventory.assets ENABLE REPLICA RULE notify_update',
          ],
        },
      ],
    }
    const p = createDatabaseResourceProvider(
      fakeService({ tableSchema: async () => ({ table: ruled }) }),
    )

    const exp = await p.expand('u', 'localix://resource/db/pg1/_/inventory/assets')

    expect(exp.ok).toBe(true)
    expect(Buffer.byteLength(exp.content ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
    expect(exp.content).toContain(
      'Rules:\n' +
        '- notify_update (native definition; after: ' +
        'ALTER TABLE ONLY inventory.assets ENABLE REPLICA RULE notify_update)',
    )
  })

  it('keeps index summaries when a long native CREATE already embeds their DDL', async () => {
    const table: DbTableSchema = {
      ...ORDERS,
      createScript: `CREATE TABLE \`orders\` (\n${'  `padding` text,\n'.repeat(400)}  KEY \`idx_orders_user\` (\`user_id\`)\n)`,
      createScriptIncludesIndexes: true,
      indexes: [
        {
          name: 'idx_orders_user',
          columns: ['user_id'],
          unique: false,
        },
      ],
    }
    const p = createDatabaseResourceProvider(fakeService({ tableSchema: async () => ({ table }) }))

    const exp = await p.expand('u', 'localix://resource/db/c1/_/main/orders')

    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('Indexes:')
    expect(exp.content).toContain('idx_orders_user (user_id)')
  })

  it('column expands to type/nullability/constraint/FK — never credentials', async () => {
    const table: DbTableSchema = {
      ...ORDERS,
      columns: ORDERS.columns.map((column) =>
        column.name === 'user_id'
          ? {
              ...column,
              postgresNotNull: {
                name: 'orders_user_id_not_null',
                validated: false,
                noInherit: true,
              },
              comment: 'Owning user identifier',
            }
          : column,
      ),
    }
    const p = createDatabaseResourceProvider(fakeService({ tableSchema: async () => ({ table }) }))
    const exp = await p.expand('u', 'localix://resource/db/pg1/_/main/orders/user_id')
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('user_id INTEGER')
    expect(exp.content).toContain('CONSTRAINT orders_user_id_not_null · NO INHERIT · NOT VALID')
    expect(exp.content).toContain('→ users(id)')
    expect(exp.content).toContain('COMMENT Owning user identifier')
  })

  it('row count is best-effort: an unknown approxRows is simply omitted', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const exp = await p.expand('u', 'localix://resource/db/c1/_/main/orders')
    expect(exp.ok).toBe(true)
    expect(exp.content).not.toContain('rows')
    expect(exp.content).toContain('CREATE TABLE orders')
  })

  it('connection node lists schema objects and sanitized recent query shapes without creds', async () => {
    const p = createDatabaseResourceProvider(
      fakeService({
        recentQueries: async () => ['SELECT * FROM orders WHERE user_id = ?'],
      }),
    )
    const exp = await p.expand('u', 'localix://resource/db/c1')
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('sqlite')
    expect(exp.content).toContain('main: orders (table), v_recent (view)')
    expect(exp.content).toContain('Recent successful query shapes')
    expect(exp.content).toContain('SELECT * FROM orders WHERE user_id = ?;')
  })

  it('bounds a very large connection inventory instead of losing the whole context block', async () => {
    const p = createDatabaseResourceProvider(
      fakeService({
        schemas: async () => ({
          schemas: {
            public: Array.from({ length: 200 }, (_, index) => ({
              name: `table_${index}`,
              type: 'table' as const,
            })),
          },
        }),
      }),
    )
    const exp = await p.expand('u', 'localix://resource/db/c1')
    expect(exp.ok).toBe(true)
    expect(exp.content!.length).toBeLessThan(5_000)
    expect(exp.content).toContain('more objects')
  })

  it('unknown connection soft-fails', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const exp = await p.expand('u', 'localix://resource/db/ghost/_/main/x')
    expect(exp.ok).toBe(false)
  })

  it('soft-fails a URI for an inherited, nonexistent schema name', async () => {
    const p = createDatabaseResourceProvider(fakeService())
    const exp = await p.expand('u', 'localix://resource/db/c1/_/constructor')
    expect(exp).toMatchObject({ ok: false, error: 'schema not found' })
  })

  it('names with spaces/punctuation round-trip via percent-encoded segments', async () => {
    const AWKWARD: DbTableSchema = { ...ORDERS, name: 'orders(archive)' }
    const p = createDatabaseResourceProvider(
      fakeService({
        schemas: async () => ({
          schemas: { 'my schema': [{ name: 'orders(archive)', type: 'table' }] } as DbSchemas,
        }),
        tableSchema: async (_u, _id, schema, table) =>
          schema === 'my schema' && table === 'orders(archive)' ? { table: AWKWARD } : null,
      }),
    )
    // Minted URIs are percent-encoded — no raw space (token grammar cuts at \S+)
    // and no trailing `)` (stripped by the composer's punctuation rule).
    const tables = await p.listChildren('u', 'localix://resource/db/c1')
    expect(tables.map((n) => n.uri)).toEqual([
      'localix://resource/db/c1/_/my%20schema/orders%28archive%29',
    ])
    const tableUri = tables[0].uri
    expect(tableUri).not.toContain(' ')
    expect(tableUri.endsWith(')')).toBe(false)
    // The encoded URI drills to columns and expands to the right table.
    const cols = await p.listChildren('u', tableUri)
    expect(cols.map((n) => n.label)).toEqual(['id', 'user_id'])
    const exp = await p.expand('u', tableUri)
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('orders')
  })
})
