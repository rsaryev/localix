/**
 * Canonical, runtime-safe description of every database engine Localix supports.
 *
 * This module deliberately has no React, Zod, Node or driver-library imports. Both the
 * browser bundle and the backend can consume it, so engine identity, connection UX and
 * static capabilities cannot drift between layers. A concrete backend adapter still owns
 * transport and query implementation; this catalog owns what the rest of the product may
 * assume about that adapter.
 */

export const DATABASE_DIALECTS = [
  'sqlite',
  'postgres',
  'mysql',
  'mssql',
  'clickhouse',
  'redis',
  'mongodb',
  'elasticsearch',
] as const

export type DbDialect = (typeof DATABASE_DIALECTS)[number]
export type EngineKind = 'sql' | 'kv' | 'document' | 'search'
export type DatabaseTransport = 'file' | 'network'
export type DatabaseCategory = 'local' | 'relational' | 'analytics' | 'nosql' | 'search'
export type DatabaseAccent = 'sky' | 'indigo' | 'amber' | 'red' | 'rose' | 'green' | 'yellow'

export interface DatabaseDriverCapabilities {
  /** Objects are grouped under multiple named schemas/namespaces. */
  multipleSchemas: boolean
  /** The engine can return values directly from INSERT/UPDATE statements. */
  returning: boolean
  /** The adapter can interrupt an in-flight query. */
  queryCancel: boolean
  /** A transaction can stay open across several console runs. */
  manualTransactions: boolean
  /** Localix may offer an SSH bastion before opening the engine transport. */
  sshTunnel: boolean
  /** The native client accepts TLS configuration. */
  tls: boolean
  /** Structured table/collection browsing is available. */
  dataBrowser: boolean
  /** SQL-style row mutation can be generated from primary-key metadata. */
  rowEditing: boolean
  /** Query plans can be requested by the SQL console. */
  explain: boolean
  /** The schema can be represented as tables/columns/relationships for an ERD. */
  relationships: boolean
  /** The workspace can generate dialect-correct CREATE TABLE drafts. */
  schemaEditing: boolean
}

/** Dialect-level operations the constrained table editor may safely generate. Keeping this
 * beside the parent driver manifest prevents editor forms from leaking engine branches. */
export interface DatabaseSchemaMutationCapabilities {
  addColumn: boolean
  dropColumn: boolean
  renameColumn: boolean
  alterColumnType: boolean
  alterColumnNullability: boolean
  alterColumnDefault: boolean
}

export type DatabaseSchemaTypeFamily = 'boolean' | 'temporal' | 'uuid' | 'text' | 'numeric' | 'json'

/**
 * Placeholder spellings accepted by a query console. The UI scanner and compiler read
 * these from the driver manifest, so adding an adapter never requires a dialect branch
 * in React.
 */
export type DatabaseQueryParameterSyntax =
  | 'question'
  | 'numbered-question'
  | 'named-colon'
  | 'named-at'
  | 'numbered-dollar'
  | 'named-dollar'

export interface DatabaseQueryParameters {
  /** Spellings recognized in user-authored SQL for this engine. */
  syntaxes: readonly DatabaseQueryParameterSyntax[]
  /**
   * Placeholder spelling accepted by the backend adapter. User spellings are compiled
   * to this shape while values remain out-of-band in the shared `params` array.
   */
  bindStyle: 'question' | 'numbered-dollar' | null
}

/** One expression the structure editor may suggest for this engine's DEFAULT clause. */
export interface DatabaseDefaultExpression {
  value: string
  detail: string
  kind: 'value' | 'keyword' | 'function'
  /** Families for which this expression should be ranked first; omission means generic. */
  appliesTo?: readonly DatabaseSchemaTypeFamily[]
}

export interface DatabaseDriverManifest {
  id: DbDialect
  label: string
  shortLabel: string
  description: string
  kind: EngineKind
  transport: DatabaseTransport
  /** Catalogue grouping only; connection behavior still comes from kind/transport/capabilities. */
  category: DatabaseCategory
  accent: DatabaseAccent
  defaultPort?: number
  /** TLS endpoint when it differs from the plaintext default (ClickHouse HTTP 8123/HTTPS 8443). */
  defaultTlsPort?: number
  defaultSchema: string
  urlSchemes: readonly string[]
  connectionPlaceholder: string
  databaseFieldLabel: string
  databaseFieldPlaceholder: string
  /** Human/model-facing language accepted by the query console and the `database_client` tool's query. */
  queryLanguage: string
  /** Safe illustrative statement for agent guidance and empty consoles. */
  queryExample: string
  /** Driver-owned placeholder grammar + backend binding target. */
  queryParameters: DatabaseQueryParameters
  /** Curated types offered by the schema designer (empty for schemaless engines). */
  schemaDataTypes: readonly string[]
  /**
   * Dialect-correct DEFAULT expressions. Mandatory (empty for schemaless engines) so a
   * newly registered driver cannot silently fall back to another engine's SQL.
   */
  schemaDefaultExpressions: readonly DatabaseDefaultExpression[]
  capabilities: DatabaseDriverCapabilities
  /** Present only for engines with a supported, SQL-shaped table structure editor. */
  schemaMutations?: DatabaseSchemaMutationCapabilities
}

const SQL_CAPABILITIES = {
  manualTransactions: true,
  dataBrowser: true,
  rowEditing: true,
  explain: true,
  relationships: true,
  schemaEditing: true,
} as const

/** Redis, MongoDB and Elasticsearch: reached over the network, browsed, never edited as rows. */
const NON_SQL_CAPABILITIES = {
  multipleSchemas: false,
  returning: false,
  queryCancel: false,
  manualTransactions: false,
  sshTunnel: true,
  tls: true,
  dataBrowser: true,
  rowEditing: false,
  explain: false,
  relationships: false,
  schemaEditing: false,
} as const

const FULL_COLUMN_MUTATIONS = {
  addColumn: true,
  dropColumn: true,
  renameColumn: true,
  alterColumnType: true,
  alterColumnNullability: true,
  alterColumnDefault: true,
} as const

const COMMON_DEFAULT_EXPRESSIONS = [
  { value: "''", detail: 'empty string', kind: 'value', appliesTo: ['text'] },
  { value: 'NULL', detail: 'explicit null', kind: 'keyword' },
  { value: '0', detail: 'number', kind: 'value', appliesTo: ['numeric', 'boolean'] },
  { value: '1', detail: 'number', kind: 'value', appliesTo: ['numeric', 'boolean'] },
] as const satisfies readonly DatabaseDefaultExpression[]

const SQL_BOOLEAN_EXPRESSIONS = [
  { value: 'TRUE', detail: 'boolean', kind: 'keyword', appliesTo: ['boolean'] },
  { value: 'FALSE', detail: 'boolean', kind: 'keyword', appliesTo: ['boolean'] },
] as const satisfies readonly DatabaseDefaultExpression[]

export const DATABASE_DRIVER_CATALOG = {
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    shortLabel: 'SL',
    description: 'Local database file or an in-memory workspace',
    kind: 'sql',
    transport: 'file',
    category: 'local',
    accent: 'sky',
    defaultSchema: 'main',
    urlSchemes: ['file'],
    connectionPlaceholder: '/path/to/database.sqlite',
    databaseFieldLabel: 'Database file',
    databaseFieldPlaceholder: '/path/to/database.sqlite',
    queryLanguage: 'SQLite SQL',
    queryExample: 'SELECT * FROM table_name LIMIT 50',
    queryParameters: {
      syntaxes: ['question', 'numbered-question', 'named-colon', 'named-at', 'named-dollar'],
      bindStyle: 'question',
    },
    schemaDataTypes: ['INTEGER', 'TEXT', 'REAL', 'NUMERIC', 'BLOB'],
    schemaDefaultExpressions: [
      ...COMMON_DEFAULT_EXPRESSIONS,
      ...SQL_BOOLEAN_EXPRESSIONS,
      {
        value: 'CURRENT_TIMESTAMP',
        detail: 'SQLite current timestamp',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_DATE',
        detail: 'SQLite current date',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_TIME',
        detail: 'SQLite current time',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: "(datetime('now'))",
        detail: 'SQLite expression',
        kind: 'function',
        appliesTo: ['temporal'],
      },
    ],
    capabilities: {
      ...SQL_CAPABILITIES,
      multipleSchemas: false,
      returning: true,
      queryCancel: false,
      sshTunnel: false,
      tls: false,
    },
    // SQLite implements only a small ALTER TABLE grammar, but the shared structure
    // planner covers the remaining column changes with SQLite's documented transactional
    // table-rebuild procedure. Keep the editor capability truthful to the complete
    // adapter, not merely to individual ALTER COLUMN statements.
    schemaMutations: FULL_COLUMN_MUTATIONS,
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    shortLabel: 'PG',
    description: 'PostgreSQL, Supabase, Neon and compatible services',
    kind: 'sql',
    transport: 'network',
    category: 'relational',
    accent: 'indigo',
    defaultPort: 5432,
    defaultSchema: 'public',
    urlSchemes: ['postgres', 'postgresql'],
    connectionPlaceholder: 'postgres://user:pass@host:5432/database',
    databaseFieldLabel: 'Database',
    databaseFieldPlaceholder: 'postgres',
    queryLanguage: 'PostgreSQL SQL',
    queryExample: 'SELECT * FROM public.table_name LIMIT 50',
    queryParameters: {
      syntaxes: ['question', 'named-colon', 'numbered-dollar'],
      bindStyle: 'numbered-dollar',
    },
    schemaDataTypes: [
      'bigserial',
      'integer',
      'bigint',
      'numeric',
      'boolean',
      'text',
      'varchar(255)',
      'date',
      'timestamp',
      'timestamptz',
      'uuid',
      'jsonb',
      'bytea',
    ],
    schemaDefaultExpressions: [
      ...COMMON_DEFAULT_EXPRESSIONS,
      ...SQL_BOOLEAN_EXPRESSIONS,
      {
        value: 'CURRENT_TIMESTAMP',
        detail: 'PostgreSQL current timestamp',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_DATE',
        detail: 'PostgreSQL current date',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'now()',
        detail: 'PostgreSQL transaction timestamp',
        kind: 'function',
        appliesTo: ['temporal'],
      },
      {
        value: 'gen_random_uuid()',
        detail: 'PostgreSQL UUID',
        kind: 'function',
        appliesTo: ['uuid'],
      },
      {
        value: "'{}'::jsonb",
        detail: 'empty JSON object',
        kind: 'value',
        appliesTo: ['json'],
      },
    ],
    capabilities: {
      ...SQL_CAPABILITIES,
      multipleSchemas: true,
      returning: true,
      queryCancel: true,
      sshTunnel: true,
      tls: true,
    },
    schemaMutations: FULL_COLUMN_MUTATIONS,
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    shortLabel: 'MY',
    description: 'MySQL, MariaDB and wire-compatible services',
    kind: 'sql',
    transport: 'network',
    category: 'relational',
    accent: 'amber',
    defaultPort: 3306,
    defaultSchema: '',
    urlSchemes: ['mysql'],
    connectionPlaceholder: 'mysql://user:pass@host:3306/database',
    databaseFieldLabel: 'Database',
    databaseFieldPlaceholder: 'mysql',
    queryLanguage: 'MySQL SQL',
    queryExample: 'SELECT * FROM table_name LIMIT 50',
    queryParameters: {
      syntaxes: ['question', 'named-colon'],
      bindStyle: 'question',
    },
    schemaDataTypes: [
      'BIGINT',
      'INT',
      'DECIMAL(10,2)',
      'BOOLEAN',
      'VARCHAR(255)',
      'TEXT',
      'DATE',
      'DATETIME',
      'TIMESTAMP',
      'JSON',
      'BLOB',
    ],
    schemaDefaultExpressions: [
      ...COMMON_DEFAULT_EXPRESSIONS,
      ...SQL_BOOLEAN_EXPRESSIONS,
      {
        value: 'CURRENT_TIMESTAMP',
        detail: 'MySQL current timestamp',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_DATE',
        detail: 'MySQL current date',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_TIME',
        detail: 'MySQL current time',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
    ],
    capabilities: {
      ...SQL_CAPABILITIES,
      multipleSchemas: false,
      returning: false,
      queryCancel: true,
      sshTunnel: true,
      tls: true,
    },
    schemaMutations: {
      ...FULL_COLUMN_MUTATIONS,
      // MySQL CHANGE/MODIFY requires a complete column definition and drops every
      // omitted attribute (AUTO_INCREMENT, generated expression, COMMENT, charset,
      // collation, and so on). The normalized schema port does not carry all of those,
      // so definition rewrites must fail closed. Rename and default have dedicated ALTER
      // forms below and do preserve the rest of the column.
      alterColumnType: false,
      alterColumnNullability: false,
    },
  },
  mssql: {
    id: 'mssql',
    label: 'SQL Server',
    shortLabel: 'MS',
    description: 'Microsoft SQL Server and Azure SQL',
    kind: 'sql',
    transport: 'network',
    category: 'relational',
    accent: 'red',
    defaultPort: 1433,
    defaultSchema: 'dbo',
    urlSchemes: ['mssql', 'sqlserver'],
    connectionPlaceholder: 'mssql://user:pass@host:1433/database',
    databaseFieldLabel: 'Database',
    databaseFieldPlaceholder: 'master',
    queryLanguage: 'T-SQL',
    queryExample: 'SELECT TOP 50 * FROM dbo.table_name',
    queryParameters: {
      syntaxes: ['question', 'named-colon', 'named-at'],
      bindStyle: 'question',
    },
    schemaDataTypes: [
      'BIGINT',
      'INT',
      'DECIMAL(18,2)',
      'BIT',
      'NVARCHAR(255)',
      'NVARCHAR(MAX)',
      'DATE',
      'DATETIME2',
      'UNIQUEIDENTIFIER',
      'VARBINARY(MAX)',
    ],
    schemaDefaultExpressions: [
      ...COMMON_DEFAULT_EXPRESSIONS,
      {
        value: 'GETDATE()',
        detail: 'SQL Server current datetime',
        kind: 'function',
        appliesTo: ['temporal'],
      },
      {
        value: 'GETUTCDATE()',
        detail: 'SQL Server current UTC datetime',
        kind: 'function',
        appliesTo: ['temporal'],
      },
      {
        value: 'CURRENT_TIMESTAMP',
        detail: 'SQL Server current timestamp',
        kind: 'keyword',
        appliesTo: ['temporal'],
      },
      {
        value: 'NEWID()',
        detail: 'SQL Server UUID',
        kind: 'function',
        appliesTo: ['uuid'],
      },
    ],
    capabilities: {
      ...SQL_CAPABILITIES,
      multipleSchemas: true,
      returning: false,
      queryCancel: true,
      sshTunnel: true,
      tls: true,
      explain: false,
    },
    schemaMutations: {
      ...FULL_COLUMN_MUTATIONS,
      // SQL Server ALTER COLUMN must restate the type, and a type change without
      // COLLATE silently resets a character column to the database default. The
      // normalized schema also omits sparse/computed/alias-type attributes, so only
      // dedicated rename plus add/drop are safe until those attributes are modelled.
      alterColumnType: false,
      alterColumnNullability: false,
      alterColumnDefault: false,
    },
  },
  clickhouse: {
    id: 'clickhouse',
    label: 'ClickHouse',
    shortLabel: 'CH',
    description: 'ClickHouse Server and ClickHouse Cloud analytics',
    kind: 'sql',
    transport: 'network',
    category: 'analytics',
    accent: 'yellow',
    defaultPort: 8123,
    defaultTlsPort: 8443,
    defaultSchema: 'default',
    urlSchemes: ['clickhouse', 'clickhouses', 'http', 'https'],
    connectionPlaceholder: 'https://user:pass@host:8443/default',
    databaseFieldLabel: 'Database',
    databaseFieldPlaceholder: 'default',
    queryLanguage: 'ClickHouse SQL',
    queryExample: 'SELECT * FROM default.table_name LIMIT 50',
    queryParameters: {
      syntaxes: ['question', 'named-colon'],
      bindStyle: 'question',
    },
    schemaDataTypes: [
      'UInt64',
      'Int64',
      'Float64',
      'Decimal(18,2)',
      'Bool',
      'String',
      'FixedString(16)',
      'Date',
      'DateTime',
      'DateTime64(3)',
      'UUID',
      'JSON',
      'Array(String)',
      'Nullable(String)',
    ],
    schemaDefaultExpressions: [
      ...COMMON_DEFAULT_EXPRESSIONS,
      ...SQL_BOOLEAN_EXPRESSIONS,
      {
        value: 'now()',
        detail: 'ClickHouse current datetime',
        kind: 'function',
        appliesTo: ['temporal'],
      },
      {
        value: 'today()',
        detail: 'ClickHouse current date',
        kind: 'function',
        appliesTo: ['temporal'],
      },
      {
        value: 'generateUUIDv4()',
        detail: 'ClickHouse UUID',
        kind: 'function',
        appliesTo: ['uuid'],
      },
    ],
    capabilities: {
      multipleSchemas: true,
      returning: false,
      queryCancel: true,
      manualTransactions: false,
      sshTunnel: true,
      tls: true,
      dataBrowser: true,
      rowEditing: false,
      explain: true,
      relationships: false,
      schemaEditing: false,
    },
  },
  redis: {
    id: 'redis',
    label: 'Redis',
    shortLabel: 'RD',
    description: 'Redis, Valkey and compatible key-value stores',
    kind: 'kv',
    transport: 'network',
    category: 'nosql',
    accent: 'rose',
    defaultPort: 6379,
    defaultSchema: 'keyspace',
    urlSchemes: ['redis', 'rediss'],
    connectionPlaceholder: 'redis://[:password@]host:6379/0',
    databaseFieldLabel: 'Database index',
    databaseFieldPlaceholder: '0',
    queryLanguage: 'Redis commands',
    queryExample: 'SCAN 0 COUNT 50',
    queryParameters: { syntaxes: [], bindStyle: null },
    schemaDataTypes: [],
    schemaDefaultExpressions: [],
    capabilities: NON_SQL_CAPABILITIES,
  },
  mongodb: {
    id: 'mongodb',
    label: 'MongoDB',
    shortLabel: 'MO',
    description: 'MongoDB and Atlas document databases',
    kind: 'document',
    transport: 'network',
    category: 'nosql',
    accent: 'green',
    defaultPort: 27017,
    defaultSchema: 'db',
    urlSchemes: ['mongodb', 'mongodb+srv'],
    connectionPlaceholder: 'mongodb://user:pass@host:27017/database',
    databaseFieldLabel: 'Database',
    databaseFieldPlaceholder: 'database',
    queryLanguage: 'MongoDB collection calls',
    queryExample: 'db.collection.find({})',
    queryParameters: { syntaxes: [], bindStyle: null },
    schemaDataTypes: [],
    schemaDefaultExpressions: [],
    capabilities: NON_SQL_CAPABILITIES,
  },
  elasticsearch: {
    id: 'elasticsearch',
    label: 'Elasticsearch',
    shortLabel: 'ES',
    description: 'Elasticsearch clusters and compatible search APIs',
    kind: 'search',
    transport: 'network',
    category: 'search',
    accent: 'yellow',
    defaultPort: 9200,
    defaultSchema: 'indices',
    urlSchemes: ['http', 'https'],
    connectionPlaceholder: 'http://user:pass@localhost:9200',
    databaseFieldLabel: 'Default index',
    databaseFieldPlaceholder: 'Optional',
    queryLanguage: 'Elasticsearch Query DSL',
    queryExample: 'index.search({"query":{"match_all":{}}})',
    queryParameters: { syntaxes: [], bindStyle: null },
    schemaDataTypes: [],
    schemaDefaultExpressions: [],
    capabilities: NON_SQL_CAPABILITIES,
  },
} as const satisfies Record<DbDialect, DatabaseDriverManifest>

export const DATABASE_DRIVERS: readonly DatabaseDriverManifest[] = DATABASE_DIALECTS.map(
  (dialect) => DATABASE_DRIVER_CATALOG[dialect],
)

export function getDatabaseDriverManifest(dialect: DbDialect): DatabaseDriverManifest {
  return DATABASE_DRIVER_CATALOG[dialect]
}

export function isDatabaseDialect(value: string): value is DbDialect {
  return (DATABASE_DIALECTS as readonly string[]).includes(value)
}

export function isFileDatabaseDialect(dialect: DbDialect): dialect is 'sqlite' {
  return DATABASE_DRIVER_CATALOG[dialect].transport === 'file'
}

export function isNetworkDatabaseDialect(
  dialect: DbDialect,
): dialect is Exclude<DbDialect, 'sqlite'> {
  return DATABASE_DRIVER_CATALOG[dialect].transport === 'network'
}
