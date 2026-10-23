import { describe, expect, it } from 'bun:test'

import {
  buildCommentStatements,
  buildIndexStatements,
  buildPostgresAccessStatements,
  buildPostgresExtendedStatisticsStatements,
  buildPostgresSequenceStateStatements,
  buildPostgresTableStateStatements,
  buildRuleStatements,
  buildTableDDL,
  buildTriggerStatements,
  reconstructCreate,
} from './ddl'
import type { DbTableSchema } from './drivers/port'

/** Shared DDL renderer contract used by the schema browser and `localix://resource/db/` model context. */
const base: DbTableSchema = {
  name: 'users',
  type: 'table',
  columns: [
    { name: 'id', dataType: 'INTEGER', nullable: false, pk: true },
    { name: 'email', dataType: 'TEXT', nullable: false, pk: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
}

describe('buildTableDDL — what the resource expander hands a model', () => {
  it('returns the engine createScript verbatim when it has one', () => {
    expect(
      buildTableDDL({ ...base, createScript: '  CREATE TABLE users (id INTEGER)  ' }, 'sqlite'),
    ).toBe('CREATE TABLE users (id INTEGER)')
  })

  it('reconstructs a CREATE from columns + inline PK + NOT NULL when it does not', () => {
    const sql = buildTableDDL(base, 'sqlite')
    expect(sql).toContain('CREATE TABLE "users" (')
    expect(sql).toContain('  "id" INTEGER PRIMARY KEY NOT NULL')
    expect(sql).toContain('  "email" TEXT NOT NULL')
  })

  it('preserves PostgreSQL 18 named, non-inheritable, and invalid NOT NULL constraints', () => {
    const sql = reconstructCreate(
      {
        ...base,
        primaryKey: [],
        columns: [
          {
            name: 'required',
            dataType: 'text',
            nullable: false,
            pk: false,
            postgresNotNull: {
              name: 'required_not_null',
              validated: true,
              noInherit: true,
            },
          },
          {
            name: 'pending_validation',
            dataType: 'text',
            nullable: false,
            pk: false,
            postgresNotNull: {
              name: 'pending_validation_not_null',
              validated: false,
            },
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain('  "required" text CONSTRAINT "required_not_null" NOT NULL NO INHERIT')
    expect(sql).toContain('  "pending_validation" text\n')
    expect(sql).not.toContain('"pending_validation" text NOT NULL')
    expect(sql).toContain(
      'ALTER TABLE "users" ADD CONSTRAINT "pending_validation_not_null" ' +
        'NOT NULL "pending_validation" NOT VALID;',
    )
  })

  it('preserves PostgreSQL relation persistence and physical clauses', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'archive',
        name: 'events',
        postgresRelation: {
          persistence: 'UNLOGGED',
          accessMethod: 'heap',
          storageParameters: ['fillfactor=70', 'autovacuum_enabled=false'],
          tablespace: 'fast space',
        },
      },
      'postgres',
    )

    expect(sql).toContain('CREATE UNLOGGED TABLE "archive"."events" (')
    expect(sql).toContain(
      ')\n' +
        'USING "heap"\n' +
        'WITH (fillfactor=70, autovacuum_enabled=false)\n' +
        'TABLESPACE "fast space";',
    )
    expect(
      reconstructCreate(
        {
          ...base,
          schema: 'pg_temp_7',
          name: 'scratch',
          postgresRelation: { persistence: 'TEMPORARY' },
        },
        'postgres',
      ),
    ).toStartWith('CREATE TEMPORARY TABLE "scratch" (')
  })

  it('normalizes PostgreSQL physical temp schemas across related DDL', () => {
    const identitySequence = {
      schema: 'pg_temp_7',
      name: 'scratch_id_seq',
      dataType: 'bigint',
      start: '5',
      increment: '1',
      minValue: '1',
      maxValue: '9223372036854775807',
      cache: '1',
      cycle: false,
      comment: 'Temporary identity',
      postgresAccess: {
        owner: 'temp owner',
        grants: [],
      },
    }
    const table: DbTableSchema = {
      ...base,
      schema: 'pg_temp_7',
      name: 'scratch',
      postgresRelation: { persistence: 'TEMPORARY' },
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          nullable: false,
          pk: true,
          identity: {
            generation: 'BY DEFAULT',
            sequence: identitySequence,
          },
        },
        {
          name: 'legacy_id',
          dataType: 'bigint',
          nullable: true,
          pk: false,
          defaultValue: "nextval('legacy_seq'::regclass)",
          ownedSequence: {
            ...identitySequence,
            name: 'legacy_seq',
            comment: undefined,
            postgresAccess: undefined,
            unlogged: true,
          },
        },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          columns: ['legacy_id'],
          refSchema: 'pg_temp_7',
          refTable: 'parent',
          refColumns: ['id'],
        },
      ],
      indexes: [
        {
          name: 'scratch_legacy_idx',
          columns: ['legacy_id'],
          unique: false,
          primary: false,
        },
      ],
    }

    const create = reconstructCreate(table, 'postgres')
    expect(create).toStartWith(
      'CREATE TEMPORARY SEQUENCE pg_temp."legacy_seq" AS bigint INCREMENT BY 1',
    )
    expect(create).toContain('CREATE TEMPORARY TABLE "scratch" (')
    expect(create).toContain('SEQUENCE NAME pg_temp."scratch_id_seq" INCREMENT BY 1')
    expect(create).toContain(`DEFAULT nextval('pg_temp."legacy_seq"'::regclass)`)
    expect(create).toContain('REFERENCES pg_temp."parent"("id")')
    expect(create).toContain('ALTER SEQUENCE pg_temp."legacy_seq" OWNED BY "scratch"."legacy_id";')
    expect(create).not.toContain('pg_temp_7')
    expect(create).not.toContain('CREATE UNLOGGED SEQUENCE')
    expect(buildIndexStatements(table, 'postgres')).toEqual([
      'CREATE INDEX "scratch_legacy_idx" ON pg_temp."scratch" ("legacy_id");',
    ])
    expect(buildPostgresSequenceStateStatements(table, 'postgres')).toEqual([
      'COMMENT ON SEQUENCE pg_temp."scratch_id_seq" IS E\'Temporary identity\';',
      'REVOKE ALL PRIVILEGES ON SEQUENCE pg_temp."scratch_id_seq" FROM "temp owner";',
    ])
  })

  it('reconstructs PostgreSQL typed tables with column options instead of copied types', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'archive',
        name: 'assets',
        primaryKey: [],
        postgresOfType: {
          schema: 'inventory',
          name: 'asset_type',
        },
        postgresRelation: {
          accessMethod: 'heap',
        },
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            pk: false,
            postgresNotNull: {
              name: 'assets_id_not_null',
              validated: true,
            },
          },
          {
            name: 'label',
            dataType: 'text',
            nullable: true,
            pk: false,
            defaultValue: "'unknown'::text",
          },
          {
            name: 'payload',
            dataType: 'jsonb',
            nullable: true,
            pk: false,
            defaultValue: null,
          },
        ],
        checkConstraints: [
          {
            name: 'assets_label_check',
            expression: "label <> ''::text",
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain(
      'CREATE TABLE "archive"."assets" OF "inventory"."asset_type" (\n' +
        '  "id" WITH OPTIONS CONSTRAINT "assets_id_not_null" NOT NULL,\n' +
        `  "label" WITH OPTIONS DEFAULT 'unknown'::text,\n` +
        `  CONSTRAINT "assets_label_check" CHECK (label <> ''::text)\n` +
        ')\n' +
        'USING "heap";',
    )
    expect(sql).not.toContain('"id" bigint')
    expect(sql).not.toContain('"label" text')
    expect(sql).not.toContain('"payload"')
  })

  it('reconstructs PostgreSQL foreign tables with server and FDW options', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'archive',
        name: 'assets',
        primaryKey: [],
        postgresForeign: {
          server: 'warehouse server',
          options: [
            { name: 'schema_name', value: 'inventory' },
            { name: 'table_name', value: "asset'archive" },
          ],
        },
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            pk: false,
            postgresForeignOptions: [{ name: 'column_name', value: 'asset_id' }],
          },
          {
            name: 'payload',
            dataType: 'jsonb',
            nullable: true,
            pk: false,
          },
        ],
        checkConstraints: [
          {
            name: 'assets_payload_check',
            expression: 'payload IS NOT NULL',
          },
        ],
      },
      'postgres',
    )

    expect(sql).toBe(
      'CREATE FOREIGN TABLE "archive"."assets" (\n' +
        `  "id" bigint OPTIONS ("column_name" 'asset_id') NOT NULL,\n` +
        '  "payload" jsonb,\n' +
        '  CONSTRAINT "assets_payload_check" CHECK (payload IS NOT NULL)\n' +
        ')\n' +
        'SERVER "warehouse server"\n' +
        `OPTIONS ("schema_name" 'inventory', "table_name" 'asset''archive');`,
    )
  })

  it('restores FDW options on inherited columns and foreign partitions', () => {
    const inherited = reconstructCreate(
      {
        ...base,
        schema: 'archive',
        name: 'assets_child',
        primaryKey: [],
        postgresInheritance: {
          parents: [{ schema: 'archive', table: 'assets_parent' }],
          localColumns: ['payload'],
        },
        postgresForeign: {
          server: 'warehouse',
        },
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: true,
            pk: false,
            postgresForeignOptions: [{ name: 'column_name', value: 'remote_id' }],
          },
          {
            name: 'payload',
            dataType: 'text',
            nullable: true,
            pk: false,
            postgresForeignOptions: [{ name: 'column_name', value: 'remote_payload' }],
          },
        ],
      },
      'postgres',
    )

    expect(inherited).toContain(
      'CREATE FOREIGN TABLE "archive"."assets_child" (\n' +
        `  "payload" text OPTIONS ("column_name" 'remote_payload')\n` +
        ')\n' +
        'INHERITS ("archive"."assets_parent")\n' +
        'SERVER "warehouse";',
    )
    expect(inherited).toContain(
      `ALTER FOREIGN TABLE "archive"."assets_child" ALTER COLUMN "id" OPTIONS (ADD "column_name" 'remote_id');`,
    )

    const partition = reconstructCreate(
      {
        ...base,
        schema: 'archive',
        name: 'assets_2026',
        primaryKey: [],
        postgresPartition: {
          parentSchema: 'archive',
          parentTable: 'assets',
          bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
        },
        postgresForeign: {
          server: 'warehouse',
          options: [{ name: 'table_name', value: 'assets_2026' }],
        },
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: true,
            pk: false,
            postgresForeignOptions: [{ name: 'column_name', value: 'remote_id' }],
          },
        ],
      },
      'postgres',
    )

    expect(partition).toStartWith(
      'CREATE FOREIGN TABLE "archive"."assets_2026" PARTITION OF "archive"."assets"\n' +
        "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')\n" +
        'SERVER "warehouse"\n' +
        `OPTIONS ("table_name" 'assets_2026');`,
    )
    expect(partition).toContain(
      `ALTER FOREIGN TABLE "archive"."assets_2026" ALTER COLUMN "id" OPTIONS (ADD "column_name" 'remote_id');`,
    )
  })

  it('reconstructs PostgreSQL column collation, storage, compression, and planner settings', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'inventory',
        name: 'assets',
        primaryKey: [],
        columns: [
          {
            name: 'label',
            dataType: 'text',
            nullable: true,
            pk: false,
            postgresCollation: {
              schema: 'pg_catalog',
              name: 'C',
            },
            postgresStatistics: 777,
            postgresAttributeOptions: [
              { name: 'n_distinct', value: '0.25' },
              { name: 'n_distinct_inherited', value: '0.5' },
            ],
          },
          {
            name: 'payload',
            dataType: 'text',
            nullable: true,
            pk: false,
            postgresStorage: 'EXTERNAL',
            postgresCompression: 'pglz',
          },
        ],
      },
      'postgres',
    )

    expect(sql).toBe(
      'CREATE TABLE "inventory"."assets" (\n' +
        '  "label" text COLLATE "pg_catalog"."C",\n' +
        '  "payload" text\n' +
        ');\n\n' +
        'ALTER TABLE ONLY "inventory"."assets" ALTER COLUMN "label" SET STATISTICS 777;\n' +
        'ALTER TABLE ONLY "inventory"."assets" ALTER COLUMN "label" SET ("n_distinct" = 0.25, "n_distinct_inherited" = 0.5);\n' +
        'ALTER TABLE ONLY "inventory"."assets" ALTER COLUMN "payload" SET STORAGE EXTERNAL;\n' +
        'ALTER TABLE ONLY "inventory"."assets" ALTER COLUMN "payload" SET COMPRESSION "pglz";',
    )

    const partition = reconstructCreate(
      {
        ...base,
        schema: 'inventory',
        name: 'assets_2026',
        primaryKey: [],
        postgresPartition: {
          parentSchema: 'inventory',
          parentTable: 'assets',
          bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
        },
        columns: [
          {
            name: 'payload',
            dataType: 'text',
            nullable: true,
            pk: false,
            postgresStorage: 'MAIN',
          },
        ],
      },
      'postgres',
    )
    expect(partition).toContain(
      'ALTER TABLE ONLY "inventory"."assets_2026" ALTER COLUMN "payload" SET STORAGE MAIN;',
    )
  })

  it('lifts a composite PK out of the columns into its own constraint', () => {
    const sql = reconstructCreate({ ...base, primaryKey: ['id', 'email'] }, 'sqlite')
    expect(sql).not.toContain('INTEGER PRIMARY KEY')
    expect(sql).toContain('  PRIMARY KEY ("id", "email")')
  })

  it('reconstructs UNIQUE constraints without duplicating their backing indexes', () => {
    const table = {
      ...base,
      indexes: [
        {
          name: 'sqlite_autoindex_users_1',
          columns: ['email'],
          unique: true,
          constraint: true,
        },
      ],
    }
    expect(reconstructCreate(table, 'sqlite')).toContain('  UNIQUE ("email")')
    expect(buildIndexStatements(table, 'sqlite')).toEqual([])
  })

  it('preserves structured PostgreSQL and SQL Server key constraints', () => {
    const postgres = reconstructCreate(
      {
        ...base,
        keyConstraints: [
          {
            name: 'orders_pkey',
            type: 'PRIMARY KEY',
            columns: ['id'],
            inherited: true,
          },
          {
            name: 'users_pkey',
            type: 'PRIMARY KEY',
            columns: ['tenant_id', 'valid_at'],
            includeColumns: ['audit_id'],
            withoutOverlaps: true,
          },
          {
            name: 'users_email_key',
            type: 'UNIQUE',
            columns: ['email'],
            nullsNotDistinct: true,
            deferrable: true,
            initiallyDeferred: true,
          },
        ],
      },
      'postgres',
    )
    expect(postgres).toContain(
      'CONSTRAINT "users_pkey" PRIMARY KEY ("tenant_id", "valid_at" WITHOUT OVERLAPS) ' +
        'INCLUDE ("audit_id")',
    )
    expect(postgres).toContain(
      'CONSTRAINT "users_email_key" UNIQUE NULLS NOT DISTINCT ("email") ' +
        'DEFERRABLE INITIALLY DEFERRED',
    )
    expect(postgres).not.toContain('"id" INTEGER PRIMARY KEY')

    const sqlServer = reconstructCreate(
      {
        ...base,
        keyConstraints: [
          {
            name: 'PK_users',
            type: 'PRIMARY KEY',
            columns: ['id'],
            orders: ['desc'],
            clustered: false,
          },
          {
            name: 'UQ_users_email',
            type: 'UNIQUE',
            columns: ['email'],
            orders: ['asc'],
            clustered: true,
          },
        ],
      },
      'mssql',
    )
    expect(sqlServer).toContain('CONSTRAINT [PK_users] PRIMARY KEY NONCLUSTERED ([id] DESC)')
    expect(sqlServer).toContain('CONSTRAINT [UQ_users_email] UNIQUE CLUSTERED ([email])')
    expect(sqlServer).not.toContain('[id] INTEGER PRIMARY KEY')
  })

  it('preserves a PostgreSQL partition key on the reconstructed parent table', () => {
    expect(
      reconstructCreate(
        {
          ...base,
          schema: 'sales',
          name: 'orders',
          postgresPartitionBy: 'RANGE ("created_at", lower(region) text_pattern_ops);',
        },
        'postgres',
      ),
    ).toContain(
      'CREATE TABLE "sales"."orders" (\n' +
        '  "id" INTEGER PRIMARY KEY NOT NULL,\n' +
        '  "email" TEXT NOT NULL\n' +
        ')\n' +
        'PARTITION BY RANGE ("created_at", lower(region) text_pattern_ops);',
    )
  })

  it('reconstructs a PostgreSQL child partition without redeclaring inherited columns', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        name: 'orders_2026',
        postgresPartitionBy: 'LIST (region)',
        postgresPartition: {
          parentSchema: 'sales',
          parentTable: 'orders',
          bound: "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
          defaultOverrides: [
            { column: 'email', value: "'unknown'" },
            { column: 'legacy', value: null },
            {
              column: 'partition_id',
              value: "nextval('sales.orders_2026_partition_id_seq'::regclass)",
            },
          ],
          notNullColumns: ['email'],
        },
        postgresRelation: {
          accessMethod: 'heap',
          storageParameters: ['fillfactor=80'],
          tablespace: 'partition space',
        },
        columns: [
          ...base.columns.map((column) =>
            column.name === 'email'
              ? {
                  ...column,
                  postgresNotNull: {
                    name: 'orders_2026_email_not_null',
                    validated: false,
                  },
                }
              : column,
          ),
          {
            name: 'partition_id',
            dataType: 'bigint',
            nullable: false,
            pk: false,
            defaultValue: "nextval('sales.orders_2026_partition_id_seq'::regclass)",
            ownedSequence: {
              schema: 'sales',
              name: 'orders_2026_partition_id_seq',
              dataType: 'bigint',
              start: '100',
              increment: '10',
              minValue: '100',
              maxValue: '9223372036854775807',
              cache: '5',
              cycle: false,
            },
          },
        ],
        keyConstraints: [
          {
            name: 'orders_2026_email_key',
            type: 'UNIQUE',
            columns: ['email'],
          },
        ],
        checkConstraints: [
          {
            name: 'orders_email_check',
            expression: "email <> 'blocked'",
            inherited: true,
          },
          {
            name: 'orders_2026_email_check',
            expression: "email <> ''",
            validated: false,
          },
        ],
        foreignKeys: [
          {
            name: 'orders_user_fkey',
            columns: ['id'],
            refSchema: 'identity',
            refTable: 'users',
            refColumns: ['id'],
            inherited: true,
          },
          {
            name: 'orders_2026_user_fkey',
            columns: ['id'],
            refSchema: 'identity',
            refTable: 'users',
            refColumns: ['id'],
            validated: false,
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain(
      'CREATE SEQUENCE "sales"."orders_2026_partition_id_seq" AS bigint ' +
        'INCREMENT BY 10 MINVALUE 100 MAXVALUE 9223372036854775807 ' +
        'NO CYCLE START WITH 100 CACHE 5;',
    )
    expect(sql).toContain(
      'CREATE TABLE "sales"."orders_2026" PARTITION OF "sales"."orders"\n' +
        "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')\n" +
        'PARTITION BY LIST (region)\n' +
        'USING "heap"\n' +
        'WITH (fillfactor=80)\n' +
        'TABLESPACE "partition space";',
    )
    expect(sql).not.toContain('"id" INTEGER')
    expect(sql).not.toContain('"orders_pkey"')
    expect(sql).not.toContain('"orders_email_check"')
    expect(sql).not.toContain('"orders_user_fkey"')
    expect(sql).toContain(
      `ALTER TABLE ONLY "sales"."orders_2026" ALTER COLUMN "email" SET DEFAULT 'unknown';`,
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "sales"."orders_2026" ALTER COLUMN "legacy" DROP DEFAULT;',
    )
    expect(sql).toContain(
      `ALTER TABLE ONLY "sales"."orders_2026" ALTER COLUMN "partition_id" SET DEFAULT nextval('"sales"."orders_2026_partition_id_seq"'::regclass);`,
    )
    expect(sql).toContain(
      'ALTER SEQUENCE "sales"."orders_2026_partition_id_seq" ' +
        'OWNED BY "sales"."orders_2026"."partition_id";',
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "sales"."orders_2026" ADD ' +
        'CONSTRAINT "orders_2026_email_not_null" NOT NULL "email" NOT VALID;',
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "sales"."orders_2026" ADD CONSTRAINT "orders_2026_email_key" UNIQUE ("email");',
    )
    expect(sql).toContain(
      `ALTER TABLE ONLY "sales"."orders_2026" ADD CONSTRAINT "orders_2026_email_check" CHECK (email <> '') NOT VALID;`,
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "sales"."orders_2026" ADD CONSTRAINT "orders_2026_user_fkey" ' +
        'FOREIGN KEY ("id") REFERENCES "identity"."users"("id") NOT VALID;',
    )
    expect(
      buildIndexStatements(
        {
          ...base,
          postgresPartition: {
            parentSchema: 'sales',
            parentTable: 'orders',
            bound: 'DEFAULT',
          },
          indexes: [
            {
              name: 'orders_2026_email_idx',
              columns: ['email'],
              unique: false,
              inherited: true,
              createScript: 'CREATE INDEX orders_2026_email_idx ON orders_2026 (email)',
            },
          ],
        },
        'postgres',
      ),
    ).toEqual([])
  })

  it('reconstructs PostgreSQL table inheritance with only local declarations', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'public',
        name: 'customer_events',
        primaryKey: [],
        postgresInheritance: {
          parents: [
            { schema: 'audit', table: 'events' },
            { schema: 'crm', table: 'customers' },
          ],
          localColumns: ['note', 'tag'],
          defaultOverrides: [
            { column: 'status', value: "'active'::text" },
            { column: 'legacy', value: null },
          ],
          notNullColumns: ['status'],
        },
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            pk: false,
            defaultValue: "nextval('audit.events_id_seq'::regclass)",
          },
          {
            name: 'status',
            dataType: 'text',
            nullable: false,
            pk: false,
            defaultValue: "'active'::text",
            postgresNotNull: {
              name: 'customer_events_status_not_null',
              validated: true,
            },
          },
          {
            name: 'legacy',
            dataType: 'text',
            nullable: true,
            pk: false,
            defaultValue: null,
          },
          {
            name: 'note',
            dataType: 'text',
            nullable: true,
            pk: false,
            defaultValue: null,
          },
          {
            name: 'tag',
            dataType: 'text',
            nullable: false,
            pk: false,
            defaultValue: "'local'::text",
          },
        ],
        keyConstraints: [
          {
            name: 'customer_events_note_key',
            type: 'UNIQUE',
            columns: ['note'],
          },
        ],
        checkConstraints: [
          {
            name: 'events_status_check',
            expression: "status <> 'invalid'::text",
            inherited: true,
          },
          {
            name: 'customer_events_note_check',
            expression: "note <> ''::text",
          },
        ],
        foreignKeys: [
          {
            name: 'customer_events_owner_fkey',
            columns: ['id'],
            refSchema: 'identity',
            refTable: 'users',
            refColumns: ['id'],
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain(
      'CREATE TABLE "public"."customer_events" (\n' +
        '  "note" text,\n' +
        `  "tag" text NOT NULL DEFAULT 'local'::text,\n` +
        '  CONSTRAINT "customer_events_note_key" UNIQUE ("note"),\n' +
        `  CONSTRAINT "customer_events_note_check" CHECK (note <> ''::text),\n` +
        '  CONSTRAINT "customer_events_owner_fkey" FOREIGN KEY ("id") ' +
        'REFERENCES "identity"."users"("id")\n' +
        ')\n' +
        'INHERITS ("audit"."events", "crm"."customers");',
    )
    expect(sql).not.toContain('"id" bigint')
    expect(sql).not.toContain('"status" text')
    expect(sql).not.toContain('"legacy" text')
    expect(sql).not.toContain('"events_status_check"')
    expect(sql).toContain(
      `ALTER TABLE ONLY "public"."customer_events" ALTER COLUMN "status" SET DEFAULT 'active'::text;`,
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "public"."customer_events" ALTER COLUMN "legacy" DROP DEFAULT;',
    )
    expect(sql).toContain(
      'ALTER TABLE ONLY "public"."customer_events" ADD ' +
        'CONSTRAINT "customer_events_status_not_null" NOT NULL "status";',
    )
  })

  it('preserves PostgreSQL exclusion constraints as native catalog clauses', () => {
    const sql = reconstructCreate(
      {
        ...base,
        exclusionConstraints: [
          {
            name: 'users_room_during_excl',
            definition:
              'EXCLUDE USING gist (room WITH =, during WITH &&) ' +
              'WHERE (cancelled_at IS NULL) DEFERRABLE INITIALLY DEFERRED',
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain(
      'CONSTRAINT "users_room_during_excl" ' +
        'EXCLUDE USING gist (room WITH =, during WITH &&) ' +
        'WHERE (cancelled_at IS NULL) DEFERRABLE INITIALLY DEFERRED',
    )
  })

  it('qualifies foreign keys and refuses to fabricate a missing view definition', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'reporting',
        type: 'view',
        foreignKeys: [
          {
            columns: ['email'],
            refSchema: 'identity',
            refTable: 'accounts',
            refColumns: ['email'],
          },
        ],
      },
      'postgres',
    )
    expect(sql).toBe('-- Definition unavailable for view "reporting"."users".')

    const tableSql = reconstructCreate(
      {
        ...base,
        schema: 'reporting',
        foreignKeys: [
          {
            columns: ['email'],
            refSchema: 'identity',
            refTable: 'accounts',
            refColumns: ['email'],
          },
        ],
      },
      'postgres',
    )
    expect(tableSql).toContain('CREATE TABLE "reporting"."users" (')
    expect(tableSql).toContain('FOREIGN KEY ("email") REFERENCES "identity"."accounts"("email")')
  })

  it('preserves named foreign-key actions, match mode, timing, and validation state', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        foreignKeys: [
          {
            name: 'orders_account_fkey',
            columns: ['email'],
            refSchema: 'identity',
            refTable: 'accounts',
            refColumns: ['email'],
            match: 'FULL',
            onDelete: 'SET NULL',
            onDeleteColumns: ['email'],
            onUpdate: 'CASCADE',
            deferrable: true,
            initiallyDeferred: true,
            validated: false,
            enforced: false,
          },
        ],
      },
      'postgres',
    )

    expect(sql).not.toContain('\n  CONSTRAINT "orders_account_fkey"')
    expect(sql).toContain(
      'ALTER TABLE "sales"."users" ADD CONSTRAINT "orders_account_fkey" ' +
        'FOREIGN KEY ("email") REFERENCES "identity"."accounts"("email") ' +
        'MATCH FULL ON DELETE SET NULL ("email") ON UPDATE CASCADE ' +
        'DEFERRABLE INITIALLY DEFERRED NOT ENFORCED NOT VALID;',
    )
  })

  it('preserves PostgreSQL temporal PERIOD foreign keys', () => {
    const sql = reconstructCreate(
      {
        ...base,
        foreignKeys: [
          {
            name: 'users_tenant_period_fkey',
            columns: ['tenant_id', 'valid_at'],
            refSchema: 'identity',
            refTable: 'tenants',
            refColumns: ['id', 'valid_at'],
            period: true,
          },
        ],
      },
      'postgres',
    )

    expect(sql).toContain(
      'CONSTRAINT "users_tenant_period_fkey" ' +
        'FOREIGN KEY ("tenant_id", PERIOD "valid_at") ' +
        'REFERENCES "identity"."tenants"("id", PERIOD "valid_at")',
    )
  })

  it('preserves SQL Server replication, disabled, and untrusted foreign-key state', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'dbo',
        foreignKeys: [
          {
            name: 'FK_users_accounts',
            columns: ['email'],
            refSchema: 'identity',
            refTable: 'accounts',
            refColumns: ['email'],
            onDelete: 'CASCADE',
            onUpdate: 'SET NULL',
            notForReplication: true,
            notTrusted: true,
          },
        ],
      },
      'mssql',
    )

    expect(sql).toContain(
      'CONSTRAINT [FK_users_accounts] FOREIGN KEY ([email]) ' +
        'REFERENCES [identity].[accounts]([email]) ON DELETE CASCADE ON UPDATE SET NULL ' +
        'NOT FOR REPLICATION',
    )
    expect(sql).toContain(
      'ALTER TABLE [dbo].[users] NOCHECK CONSTRAINT [FK_users_accounts];\n' +
        'ALTER TABLE [dbo].[users] CHECK CONSTRAINT [FK_users_accounts];',
    )

    const disabled = reconstructCreate(
      {
        ...base,
        foreignKeys: [
          {
            name: 'FK_users_accounts',
            columns: ['email'],
            refTable: 'accounts',
            refColumns: ['email'],
            disabled: true,
          },
        ],
      },
      'mssql',
    )
    expect(disabled).toContain('ALTER TABLE [users] NOCHECK CONSTRAINT [FK_users_accounts];')
    expect(disabled).not.toContain('\nALTER TABLE [users] CHECK CONSTRAINT [FK_users_accounts];')
  })

  it('preserves PostgreSQL and SQL Server CHECK constraint semantics', () => {
    const postgres = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        checkConstraints: [
          {
            name: 'users_score_check',
            expression: 'score >= 0',
            noInherit: true,
            enforced: false,
            validated: false,
          },
        ],
      },
      'postgres',
    )
    expect(postgres).not.toContain('\n  CONSTRAINT "users_score_check"')
    expect(postgres).toContain(
      'ALTER TABLE "sales"."users" ADD CONSTRAINT "users_score_check" ' +
        'CHECK (score >= 0) NO INHERIT NOT ENFORCED NOT VALID;',
    )

    const sqlServer = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        checkConstraints: [
          {
            name: 'CK_users_score',
            expression: '([score]>=(0))',
            notForReplication: true,
            disabled: true,
          },
          {
            name: 'CK_users_email',
            expression: "([email]<>'')",
            notTrusted: true,
          },
        ],
      },
      'mssql',
    )
    expect(sqlServer).toContain(
      'CONSTRAINT [CK_users_score] CHECK NOT FOR REPLICATION ([score]>=(0))',
    )
    expect(sqlServer).toContain("CONSTRAINT [CK_users_email] CHECK ([email]<>'')")
    expect(sqlServer).toContain('ALTER TABLE [sales].[users] NOCHECK CONSTRAINT [CK_users_score];')
    expect(sqlServer).not.toContain(
      'ALTER TABLE [sales].[users] CHECK CONSTRAINT [CK_users_score];',
    )
    expect(sqlServer).toContain(
      'ALTER TABLE [sales].[users] NOCHECK CONSTRAINT [CK_users_email];\n' +
        'ALTER TABLE [sales].[users] CHECK CONSTRAINT [CK_users_email];',
    )
  })

  it('omits referenced columns when the engine reports an implicit primary-key target', () => {
    expect(
      reconstructCreate(
        {
          ...base,
          foreignKeys: [{ columns: ['email'], refTable: 'accounts', refColumns: [] }],
        },
        'sqlite',
      ),
    ).toContain('FOREIGN KEY ("email") REFERENCES "accounts"')
  })

  it('recreates PostgreSQL identity, generated, and serial-style sequence semantics', () => {
    const sequence = {
      schema: 'sales',
      name: 'orders_id_seq',
      dataType: 'bigint',
      start: '10',
      increment: '5',
      minValue: '10',
      maxValue: '9223372036854775807',
      cache: '20',
      cycle: false,
      unlogged: true,
    }
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            pk: true,
            identity: { generation: 'ALWAYS', sequence },
          },
          {
            name: 'legacy_id',
            dataType: 'integer',
            nullable: false,
            pk: false,
            defaultValue: "nextval('old_name'::regclass)",
            ownedSequence: {
              ...sequence,
              name: 'legacy_seq',
              dataType: 'integer',
              start: '1',
              increment: '1',
              minValue: '1',
              maxValue: '2147483647',
              cache: '1',
              unlogged: undefined,
            },
          },
          {
            name: 'total',
            dataType: 'numeric',
            nullable: true,
            pk: false,
            generated: {
              expression: '(quantity * unit_price)',
              storage: 'STORED',
            },
          },
        ],
        primaryKey: ['id'],
      },
      'postgres',
    )

    expect(sql).toStartWith(
      'CREATE SEQUENCE "sales"."legacy_seq" AS integer INCREMENT BY 1 ' +
        'MINVALUE 1 MAXVALUE 2147483647 NO CYCLE START WITH 1 CACHE 1;',
    )
    expect(sql).toContain(
      '"id" bigint GENERATED ALWAYS AS IDENTITY ' +
        '(SEQUENCE NAME "sales"."orders_id_seq" INCREMENT BY 5 ' +
        'MINVALUE 10 MAXVALUE 9223372036854775807 NO CYCLE START WITH 10 CACHE 20 UNLOGGED) ' +
        'PRIMARY KEY NOT NULL',
    )
    expect(sql).toContain(
      `"legacy_id" integer NOT NULL DEFAULT nextval('"sales"."legacy_seq"'::regclass)`,
    )
    expect(sql).toContain('"total" numeric GENERATED ALWAYS AS ((quantity * unit_price)) STORED')
    expect(sql).toContain(
      'ALTER SEQUENCE "sales"."legacy_seq" OWNED BY "sales"."users"."legacy_id";',
    )
    expect(sql).not.toContain("nextval('old_name'::regclass)")

    const loggedOverride = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        postgresRelation: { persistence: 'UNLOGGED' },
        columns: [
          {
            ...base.columns[0]!,
            dataType: 'bigint',
            identity: {
              generation: 'BY DEFAULT',
              sequence: {
                ...sequence,
                logged: true,
                unlogged: undefined,
              },
            },
          },
        ],
        primaryKey: ['id'],
      },
      'postgres',
    )
    expect(loggedOverride).toContain(
      'SEQUENCE NAME "sales"."orders_id_seq" INCREMENT BY 5 ' +
        'MINVALUE 10 MAXVALUE 9223372036854775807 NO CYCLE START WITH 10 CACHE 20 LOGGED',
    )
  })

  it('recreates SQL Server identity, computed, collation, sparse, and ROWGUID semantics', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        columns: [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            pk: true,
            sqlServerIdentity: {
              seed: '100',
              increment: '10',
              notForReplication: true,
            },
          },
          {
            name: 'row_id',
            dataType: 'uniqueidentifier',
            nullable: false,
            pk: false,
            defaultValue: '(newsequentialid())',
            defaultConstraintName: 'DF_orders_row_id',
            rowGuid: true,
          },
          {
            name: 'nickname',
            dataType: 'nvarchar(100)',
            nullable: true,
            pk: false,
            collation: 'Latin1_General_100_CI_AS_SC',
            sparse: true,
          },
          {
            name: 'sparse_values',
            dataType: 'xml',
            nullable: true,
            pk: false,
            columnSet: true,
          },
          {
            name: 'total',
            dataType: 'decimal(18,2)',
            nullable: false,
            pk: false,
            sqlServerComputed: {
              expression: '([quantity]*[unit_price])',
              persisted: true,
            },
          },
        ],
        primaryKey: ['id'],
      },
      'mssql',
    )

    expect(sql).toContain('[id] bigint IDENTITY(100, 10) NOT FOR REPLICATION NOT NULL PRIMARY KEY')
    expect(sql).toContain(
      '[row_id] uniqueidentifier CONSTRAINT [DF_orders_row_id] ' +
        'DEFAULT (newsequentialid()) NOT NULL ROWGUIDCOL',
    )
    expect(sql).toContain(
      '[nickname] nvarchar(100) COLLATE Latin1_General_100_CI_AS_SC SPARSE NULL',
    )
    expect(sql).toContain('[sparse_values] XML COLUMN_SET FOR ALL_SPARSE_COLUMNS')
    expect(sql).not.toContain('[sparse_values] xml')
    expect(sql).toContain('[total] AS ([quantity]*[unit_price]) PERSISTED NOT NULL')
    expect(sql).not.toContain('[total] decimal')
  })

  it('recreates SQL Server system-time periods and their history-table link', () => {
    const sql = reconstructCreate(
      {
        ...base,
        schema: 'sales',
        columns: [
          {
            name: 'id',
            dataType: 'int',
            nullable: false,
            pk: true,
          },
          {
            name: 'valid_from',
            dataType: 'datetime2(7)',
            nullable: false,
            pk: false,
            defaultValue: '(sysutcdatetime())',
            defaultConstraintName: 'DF_orders_valid_from',
            sqlServerGeneratedAlways: 'ROW START',
            sqlServerHidden: true,
          },
          {
            name: 'valid_to',
            dataType: 'datetime2(7)',
            nullable: false,
            pk: false,
            defaultValue: "('9999-12-31 23:59:59.9999999')",
            defaultConstraintName: 'DF_orders_valid_to',
            sqlServerGeneratedAlways: 'ROW END',
          },
        ],
        primaryKey: ['id'],
        sqlServerTemporal: {
          periodStart: 'valid_from',
          periodEnd: 'valid_to',
          systemVersioned: true,
          historySchema: 'history',
          historyTable: 'orders_history',
        },
      },
      'mssql',
    )

    expect(sql).toContain(
      '[valid_from] datetime2(7) CONSTRAINT [DF_orders_valid_from] ' +
        'DEFAULT (sysutcdatetime()) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL',
    )
    expect(sql).toContain(
      '[valid_to] datetime2(7) CONSTRAINT [DF_orders_valid_to] ' +
        "DEFAULT ('9999-12-31 23:59:59.9999999') GENERATED ALWAYS AS ROW END NOT NULL",
    )
    expect(sql).toContain('PERIOD FOR SYSTEM_TIME ([valid_from], [valid_to])')
    expect(sql).toEndWith(
      'WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = [history].[orders_history]));',
    )
  })

  it('keeps a SQL Server system-time period when versioning is currently disabled', () => {
    const sql = reconstructCreate(
      {
        ...base,
        columns: [
          ...base.columns,
          {
            name: 'valid_from',
            dataType: 'datetime2',
            nullable: false,
            pk: false,
            sqlServerGeneratedAlways: 'ROW START',
          },
          {
            name: 'valid_to',
            dataType: 'datetime2',
            nullable: false,
            pk: false,
            sqlServerGeneratedAlways: 'ROW END',
          },
        ],
        sqlServerTemporal: {
          periodStart: 'valid_from',
          periodEnd: 'valid_to',
          systemVersioned: false,
        },
      },
      'mssql',
    )

    expect(sql).toContain('PERIOD FOR SYSTEM_TIME ([valid_from], [valid_to])')
    expect(sql).not.toContain('SYSTEM_VERSIONING')
  })

  it('does NOT append explicit indexes — the model-facing DDL is the CREATE alone', () => {
    // The gap, recorded. The schema browser composes buildIndexStatements on top; this caller
    // does not, and that is the difference between what the user sees and what the agent reads.
    const withIndex = {
      ...base,
      indexes: [{ name: 'idx_email', columns: ['email'], unique: true, primary: false }],
    }
    expect(buildTableDDL(withIndex, 'sqlite')).not.toContain('INDEX')
  })
})

describe('buildCommentStatements — PostgreSQL relation documentation', () => {
  it('quotes identifiers and escapes relation and column comments as E-strings', () => {
    expect(
      buildCommentStatements(
        {
          ...base,
          schema: 'odd"schema',
          name: 'event log',
          comment: "Owner's path C:\\data\nsecond line",
          columns: [
            {
              ...base.columns[0]!,
              name: 'event"id',
              comment: "quote ' and slash \\",
            },
            base.columns[1]!,
          ],
        },
        'postgres',
      ),
    ).toEqual([
      'COMMENT ON TABLE "odd""schema"."event log" IS E\'Owner\'\'s path C:\\\\data\nsecond line\';',
      'COMMENT ON COLUMN "odd""schema"."event log"."event""id" IS E\'quote \'\' and slash \\\\\';',
    ])
  })

  it('uses the exact relation kind and skips comments whose view cannot be recreated', () => {
    expect(
      buildCommentStatements(
        {
          ...base,
          type: 'view',
          comment: 'daily summary',
          createScript: 'CREATE MATERIALIZED VIEW "daily" AS SELECT 1',
        },
        'postgres',
      ),
    ).toEqual(['COMMENT ON MATERIALIZED VIEW "users" IS E\'daily summary\';'])
    expect(
      buildCommentStatements(
        {
          ...base,
          comment: 'remote rows',
          postgresForeign: { server: 'warehouse' },
        },
        'postgres',
      ),
    ).toEqual(['COMMENT ON FOREIGN TABLE "users" IS E\'remote rows\';'])
    expect(
      buildCommentStatements({ ...base, type: 'view', comment: 'hidden' }, 'postgres'),
    ).toEqual([])
    expect(
      buildCommentStatements(
        {
          ...base,
          comment: '',
          columns: base.columns.map((column) => ({ ...column, comment: '' })),
        },
        'postgres',
      ),
    ).toEqual([])
    expect(buildCommentStatements({ ...base, comment: 'ignored' }, 'sqlite')).toEqual([])
  })
})

describe('buildPostgresTableStateStatements — post-index table semantics', () => {
  it('recreates policies, RLS flags, and an index-backed replica identity', () => {
    expect(
      buildPostgresTableStateStatements(
        {
          ...base,
          schema: 'inventory',
          name: 'assets',
          postgresRowSecurity: {
            enabled: true,
            forced: true,
            policies: [
              {
                name: 'tenant visibility',
                command: 'SELECT',
                permissive: false,
                roles: ['PUBLIC', 'reporting "role'],
                using: 'tenant_id = CURRENT_USER',
              },
              {
                name: 'tenant writes',
                command: 'INSERT',
                permissive: true,
                roles: ['writer'],
                withCheck: 'tenant_id = CURRENT_USER',
              },
            ],
          },
          postgresReplicaIdentity: {
            mode: 'INDEX',
            index: 'assets_replica_key',
          },
          postgresClusteredIndex: 'assets_cluster_key',
        },
        'postgres',
      ),
    ).toEqual([
      'CREATE POLICY "tenant visibility" ON "inventory"."assets"\n' +
        'AS RESTRICTIVE\n' +
        'FOR SELECT\n' +
        'TO PUBLIC, "reporting ""role"\n' +
        'USING (tenant_id = CURRENT_USER);',
      'CREATE POLICY "tenant writes" ON "inventory"."assets"\n' +
        'AS PERMISSIVE\n' +
        'FOR INSERT\n' +
        'TO "writer"\n' +
        'WITH CHECK (tenant_id = CURRENT_USER);',
      'ALTER TABLE ONLY "inventory"."assets" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE ONLY "inventory"."assets" FORCE ROW LEVEL SECURITY;',
      'ALTER TABLE ONLY "inventory"."assets" CLUSTER ON "assets_cluster_key";',
      'ALTER TABLE ONLY "inventory"."assets" REPLICA IDENTITY USING INDEX "assets_replica_key";',
    ])
  })

  it('keeps policies while RLS is disabled and omits PostgreSQL state for other dialects', () => {
    const table: DbTableSchema = {
      ...base,
      postgresRowSecurity: {
        enabled: false,
        forced: false,
        policies: [
          {
            name: 'dormant',
            command: 'ALL',
            permissive: true,
            roles: [],
          },
        ],
      },
      postgresReplicaIdentity: { mode: 'NOTHING' },
    }
    expect(buildPostgresTableStateStatements(table, 'postgres')).toEqual([
      'CREATE POLICY "dormant" ON "users"\nAS PERMISSIVE\nFOR ALL\nTO PUBLIC;',
      'ALTER TABLE ONLY "users" REPLICA IDENTITY NOTHING;',
    ])
    expect(buildPostgresTableStateStatements(table, 'sqlite')).toEqual([])
  })
})

describe('buildPostgresExtendedStatisticsStatements — planner metadata', () => {
  const statistic = {
    schema: 'metrics',
    name: 'event"shape',
    createScript:
      'CREATE STATISTICS metrics."event""shape" (dependencies, mcv) ' +
      'ON tenant_id, lower(email) FROM app.events;;',
    owner: 'stats owner',
    statisticsTarget: 0,
    comment: "Planner's \\ guide",
  }

  it('restores native definitions, zero targets, owners, and comments', () => {
    expect(
      buildPostgresExtendedStatisticsStatements(
        {
          ...base,
          schema: 'app',
          postgresExtendedStatistics: [statistic],
        },
        'postgres',
      ),
    ).toEqual([
      'CREATE STATISTICS metrics."event""shape" (dependencies, mcv) ' +
        'ON tenant_id, lower(email) FROM app.events;',
      'ALTER STATISTICS "metrics"."event""shape" SET STATISTICS 0;',
      'ALTER STATISTICS "metrics"."event""shape" OWNER TO "stats owner";',
      'COMMENT ON STATISTICS "metrics"."event""shape" IS E\'Planner\'\'s \\\\ guide\';',
    ])
  })

  it('uses stable temp targets and only accepts supported PostgreSQL relations', () => {
    const temporary = {
      ...base,
      schema: 'pg_temp_9',
      postgresRelation: { persistence: 'TEMPORARY' as const },
      postgresExtendedStatistics: [
        {
          ...statistic,
          schema: 'pg_temp_9',
          name: 'scratch_stats',
          createScript:
            'CREATE STATISTICS pg_temp.scratch_stats (dependencies) ON id, email FROM scratch',
          statisticsTarget: undefined,
          comment: undefined,
        },
      ],
    }
    expect(buildPostgresExtendedStatisticsStatements(temporary, 'postgres')).toEqual([
      'CREATE STATISTICS pg_temp.scratch_stats (dependencies) ON id, email FROM scratch;',
      'ALTER STATISTICS pg_temp."scratch_stats" OWNER TO "stats owner";',
    ])
    expect(buildPostgresExtendedStatisticsStatements(temporary, 'sqlite')).toEqual([])
    expect(
      buildPostgresExtendedStatisticsStatements(
        { ...temporary, type: 'view', createScript: 'CREATE TEMPORARY VIEW scratch AS SELECT 1' },
        'postgres',
      ),
    ).toEqual([])
    expect(
      buildPostgresExtendedStatisticsStatements(
        {
          ...temporary,
          type: 'view',
          createScript: 'CREATE MATERIALIZED VIEW pg_temp.scratch AS SELECT 1',
        },
        'postgres',
      ),
    ).toHaveLength(2)
  })
})

describe('buildPostgresAccessStatements — owner and ACL replay', () => {
  it('restores an explicit table ACL before delegated and column grants', () => {
    const statements = buildPostgresAccessStatements(
      {
        ...base,
        schema: 'app',
        name: 'event log',
        postgresAccess: {
          owner: 'data owner',
          tableGrants: [
            {
              grantor: 'delegator',
              grantee: 'downstream',
              privilege: 'SELECT',
              grantable: false,
            },
            {
              grantor: 'data owner',
              grantee: 'delegator',
              privilege: 'SELECT',
              grantable: true,
            },
            {
              grantor: 'data owner',
              grantee: 'delegator',
              privilege: 'UPDATE',
              grantable: true,
            },
            {
              grantor: 'data owner',
              grantee: 'reader',
              privilege: 'SELECT',
              grantable: false,
            },
            {
              grantor: 'data owner',
              privilege: 'INSERT',
              grantable: false,
            },
          ],
          columnGrants: [
            {
              column: 'email',
              grants: [
                {
                  grantor: 'delegator',
                  grantee: 'downstream',
                  privilege: 'UPDATE',
                  grantable: false,
                },
              ],
            },
          ],
        },
      },
      'postgres',
    )

    expect(statements[0]).toBe('ALTER TABLE "app"."event log" OWNER TO "data owner";')
    expect(statements[1]).toBe(
      'REVOKE ALL PRIVILEGES ON TABLE "app"."event log" FROM "data owner";',
    )
    expect(statements).toContain(
      'GRANT SELECT, UPDATE ON TABLE "app"."event log" TO "delegator" WITH GRANT OPTION;',
    )
    expect(statements).toContain('GRANT INSERT ON TABLE "app"."event log" TO PUBLIC;')
    expect(statements).toContain(
      'GRANT UPDATE ("email") ON TABLE "app"."event log" TO "downstream";',
    )
    const grantOptionAt = statements.indexOf(
      'GRANT SELECT, UPDATE ON TABLE "app"."event log" TO "delegator" WITH GRANT OPTION;',
    )
    const delegatedTableAt = statements.indexOf(
      'GRANT SELECT ON TABLE "app"."event log" TO "downstream";',
    )
    const delegatedColumnAt = statements.indexOf(
      'GRANT UPDATE ("email") ON TABLE "app"."event log" TO "downstream";',
    )
    expect(grantOptionAt).toBeGreaterThan(1)
    expect(delegatedTableAt).toBeGreaterThan(grantOptionAt)
    expect(delegatedColumnAt).toBeGreaterThan(delegatedTableAt)
    expect(statements.slice(delegatedTableAt - 1, delegatedTableAt + 2)).toEqual([
      'SET SESSION AUTHORIZATION "delegator";',
      'GRANT SELECT ON TABLE "app"."event log" TO "downstream";',
      'RESET SESSION AUTHORIZATION;',
    ])
    expect(statements.slice(delegatedColumnAt - 1, delegatedColumnAt + 2)).toEqual([
      'SET SESSION AUTHORIZATION "delegator";',
      'GRANT UPDATE ("email") ON TABLE "app"."event log" TO "downstream";',
      'RESET SESSION AUTHORIZATION;',
    ])
  })

  it('distinguishes default and explicit-empty ACLs and uses each relation kind', () => {
    expect(
      buildPostgresAccessStatements(
        {
          ...base,
          postgresAccess: { owner: 'owner' },
        },
        'postgres',
      ),
    ).toEqual(['ALTER TABLE "users" OWNER TO "owner";'])
    expect(
      buildPostgresAccessStatements(
        {
          ...base,
          postgresForeign: { server: 'warehouse' },
          postgresAccess: { owner: 'owner', tableGrants: [] },
        },
        'postgres',
      ),
    ).toEqual([
      'ALTER FOREIGN TABLE "users" OWNER TO "owner";',
      'REVOKE ALL PRIVILEGES ON TABLE "users" FROM "owner";',
    ])
    expect(
      buildPostgresAccessStatements(
        {
          ...base,
          type: 'view',
          createScript: 'CREATE MATERIALIZED VIEW users AS SELECT 1',
          postgresAccess: { owner: 'owner' },
        },
        'postgres',
      ),
    ).toEqual(['ALTER MATERIALIZED VIEW "users" OWNER TO "owner";'])
    expect(
      buildPostgresAccessStatements(
        {
          ...base,
          type: 'view',
          postgresAccess: { owner: 'owner' },
        },
        'postgres',
      ),
    ).toEqual([])
    expect(
      buildPostgresAccessStatements(
        {
          ...base,
          postgresAccess: { owner: 'owner' },
        },
        'sqlite',
      ),
    ).toEqual([])
  })
})

describe('buildPostgresSequenceStateStatements — owned sequence metadata', () => {
  it('restores comments, an explicit ACL, grant options, and delegated grants', () => {
    const statements = buildPostgresSequenceStateStatements(
      {
        ...base,
        schema: 'sales',
        columns: [
          {
            ...base.columns[0]!,
            identity: {
              generation: 'ALWAYS',
              sequence: {
                schema: 'sales',
                name: 'order"id_seq',
                dataType: 'bigint',
                start: '1',
                increment: '1',
                minValue: '1',
                maxValue: '9223372036854775807',
                cache: '1',
                cycle: false,
                comment: "Order's sequence",
                postgresAccess: {
                  owner: 'data owner',
                  grants: [
                    {
                      grantor: 'delegator',
                      grantee: 'downstream',
                      privilege: 'USAGE',
                      grantable: false,
                    },
                    {
                      grantor: 'data owner',
                      grantee: 'delegator',
                      privilege: 'USAGE',
                      grantable: true,
                    },
                    {
                      grantor: 'data owner',
                      privilege: 'SELECT',
                      grantable: false,
                    },
                  ],
                },
              },
            },
          },
        ],
      },
      'postgres',
    )

    expect(statements).toEqual([
      'COMMENT ON SEQUENCE "sales"."order""id_seq" IS E\'Order\'\'s sequence\';',
      'REVOKE ALL PRIVILEGES ON SEQUENCE "sales"."order""id_seq" FROM "data owner";',
      'GRANT USAGE ON SEQUENCE "sales"."order""id_seq" TO "delegator" WITH GRANT OPTION;',
      'GRANT SELECT ON SEQUENCE "sales"."order""id_seq" TO PUBLIC;',
      'SET SESSION AUTHORIZATION "delegator";',
      'GRANT USAGE ON SEQUENCE "sales"."order""id_seq" TO "downstream";',
      'RESET SESSION AUTHORIZATION;',
    ])
  })

  it('keeps default and explicit-empty ACLs distinct and omits other dialects', () => {
    const sequence = {
      schema: 'public',
      name: 'users_id_seq',
      dataType: 'bigint',
      start: '1',
      increment: '1',
      minValue: '1',
      maxValue: '9223372036854775807',
      cache: '1',
      cycle: false,
      comment: 'User identifiers',
      postgresAccess: {
        owner: 'owner',
      },
    }
    const table: DbTableSchema = {
      ...base,
      columns: [
        {
          ...base.columns[0]!,
          ownedSequence: sequence,
        },
      ],
    }
    expect(buildPostgresSequenceStateStatements(table, 'postgres')).toEqual([
      'COMMENT ON SEQUENCE "public"."users_id_seq" IS E\'User identifiers\';',
    ])
    expect(
      buildPostgresSequenceStateStatements(
        {
          ...table,
          columns: [
            {
              ...base.columns[0]!,
              ownedSequence: {
                ...sequence,
                postgresAccess: { owner: 'owner', grants: [] },
              },
            },
          ],
        },
        'postgres',
      ),
    ).toEqual([
      'COMMENT ON SEQUENCE "public"."users_id_seq" IS E\'User identifiers\';',
      'REVOKE ALL PRIVILEGES ON SEQUENCE "public"."users_id_seq" FROM "owner";',
    ])
    expect(buildPostgresSequenceStateStatements(table, 'sqlite')).toEqual([])
    expect(
      buildPostgresSequenceStateStatements(
        { ...table, type: 'view', createScript: 'CREATE VIEW users AS SELECT 1' },
        'postgres',
      ),
    ).toEqual([])
  })
})

describe('buildRuleStatements — native PostgreSQL rewrite-rule lifecycle', () => {
  it('normalizes native rule definitions and restores non-default state', () => {
    expect(
      buildRuleStatements({
        ...base,
        rules: [
          {
            name: 'notify_update',
            createScript:
              '  CREATE RULE notify_update AS ON UPDATE TO users DO ALSO NOTIFY audit; ',
            postCreateScripts: ['ALTER TABLE ONLY "users" ENABLE ALWAYS RULE "notify_update";'],
          },
        ],
      }),
    ).toEqual([
      'CREATE RULE notify_update AS ON UPDATE TO users DO ALSO NOTIFY audit;',
      'ALTER TABLE ONLY "users" ENABLE ALWAYS RULE "notify_update";',
    ])
  })

  it('does not emit rules when the defining view is unavailable', () => {
    expect(
      buildRuleStatements({
        ...base,
        type: 'view',
        rules: [
          {
            name: 'view_insert',
            createScript: 'CREATE RULE view_insert AS ON INSERT TO users DO INSTEAD NOTHING',
          },
        ],
      }),
    ).toEqual([])
  })
})

describe('buildTriggerStatements — native trigger creation lifecycle', () => {
  it('normalizes a native trigger definition to one terminator', () => {
    expect(
      buildTriggerStatements({
        ...base,
        triggers: [
          {
            name: 'users_audit',
            createScript:
              'CREATE TRIGGER users_audit AFTER UPDATE ON users BEGIN SELECT NEW.id; END;;;  ',
            preCreateScripts: [' SET sql_mode = STRICT_ALL_TABLES;; '],
            postCreateScripts: [' ALTER TABLE users DISABLE TRIGGER users_audit;; '],
          },
          {
            name: 'encrypted_audit',
            createScript: ' -- Definition unavailable for trigger encrypted_audit ',
            definitionUnavailable: true,
          },
        ],
      }),
    ).toEqual([
      'SET sql_mode = STRICT_ALL_TABLES;',
      'CREATE TRIGGER users_audit AFTER UPDATE ON users BEGIN SELECT NEW.id; END;',
      'ALTER TABLE users DISABLE TRIGGER users_audit;',
      '-- Definition unavailable for trigger encrypted_audit;',
    ])
  })

  it('does not emit a trigger whose view definition is unavailable', () => {
    expect(
      buildTriggerStatements({
        ...base,
        name: 'active_users',
        type: 'view',
        triggers: [
          {
            name: 'active_users_insert',
            createScript:
              'CREATE TRIGGER active_users_insert INSTEAD OF INSERT ON active_users BEGIN SELECT 1; END',
          },
        ],
      }),
    ).toEqual([])
  })
})

describe('buildIndexStatements — the piece a createScript never carries', () => {
  it('renders explicit indexes and skips the PK index', () => {
    const stmts = buildIndexStatements(
      {
        ...base,
        indexes: [
          { name: 'pk_users', columns: ['id'], unique: true, primary: true },
          { name: 'idx_email', columns: ['email'], unique: true, primary: false },
          { name: 'idx_name', columns: ['email', 'id'], unique: false, primary: false },
        ],
      },
      'sqlite',
    )
    expect(stmts).toEqual([
      'CREATE UNIQUE INDEX "idx_email" ON "users" ("email");',
      'CREATE INDEX "idx_name" ON "users" ("email", "id");',
    ])
  })

  it('preserves native index DDL and reconstructable engine attributes', () => {
    expect(
      buildIndexStatements(
        {
          ...base,
          indexes: [
            {
              name: 'idx_email',
              columns: ['email'],
              unique: false,
              createScript: 'CREATE INDEX idx_email ON users (email COLLATE nocase DESC)',
            },
          ],
        },
        'sqlite',
      ),
    ).toEqual(['CREATE INDEX idx_email ON users (email COLLATE nocase DESC);'])

    expect(
      buildIndexStatements(
        {
          ...base,
          schema: 'dbo',
          indexes: [
            {
              name: 'idx_email',
              columns: ['email', 'id'],
              unique: true,
              clustered: true,
              orders: ['desc', 'asc'],
              includeColumns: ['display_name'],
            },
          ],
        },
        'mssql',
      ),
    ).toEqual([
      'CREATE UNIQUE CLUSTERED INDEX [idx_email] ON [dbo].[users] ([email] DESC, [id]) INCLUDE ([display_name]);',
    ])

    expect(
      buildIndexStatements(
        {
          ...base,
          schema: 'app',
          indexes: [
            {
              name: 'idx_email',
              columns: ['email'],
              unique: false,
              orders: ['desc'],
              prefixLengths: [24],
            },
          ],
        },
        'mysql',
      ),
    ).toEqual(['CREATE INDEX `idx_email` ON `app`.`users` (`email`(24) DESC);'])
  })

  it('is empty for a table with none', () => {
    expect(buildIndexStatements(base, 'sqlite')).toEqual([])
  })

  it('does not append indexes already embedded in a native table definition', () => {
    expect(
      buildIndexStatements(
        {
          ...base,
          createScript: 'CREATE TABLE `users` (`id` bigint PRIMARY KEY, KEY `idx_email` (`email`))',
          createScriptIncludesIndexes: true,
          indexes: [{ name: 'idx_email', columns: ['email'], unique: false }],
        },
        'mysql',
      ),
    ).toEqual([])
  })

  it('qualifies the indexed table and omits indexes when a view definition is unavailable', () => {
    const table = {
      ...base,
      schema: 'reporting',
      indexes: [{ name: 'idx_email', columns: ['email'], unique: false }],
    }
    expect(buildIndexStatements(table, 'postgres')).toEqual([
      'CREATE INDEX "idx_email" ON "reporting"."users" ("email");',
    ])
    expect(buildIndexStatements({ ...table, type: 'view' }, 'postgres')).toEqual([])
  })
})
