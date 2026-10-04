/**
 * Agnostic database-driver port. One narrow interface every SQL engine implements;
 * the UI and autocomplete never branch on engine type — they read `DriverFlags`
 * (capability descriptor) and the normalized schema/result shapes below.
 *
 * The server-side port leaves connection and transport lifecycle to each concrete driver:
 * there is no `connect()` method here, and the port assumes only an asynchronous `query`.
 */

import {
  getDatabaseDriverManifest,
  type DbDialect,
  type EngineKind,
} from '../../shared/driver-catalog'
import type { DbValidation } from './validation'

export type { DbDialect, EngineKind } from '../../shared/driver-catalog'
export type { DbValidation } from './validation'

/**
 * The family a driver belongs to. SQL engines share the SQL console + schema-as-columns +
 * PK row-editing; non-SQL engines ('kv' = Redis, 'document' = Mongo, 'search' = Elasticsearch)
 * reuse the connection registry + result grid but get their own query surface and browser.
 * SQL-only UI/behaviour gates on `kind === 'sql'` (never on `dialect`).
 */
/** Capability descriptor — the UI adapts on flags, not on `dialect` branches. */
export interface DriverFlags {
  dialect: DbDialect
  /** Engine family — drives whether the SQL-shaped UI (SQL editor, columns/PK, EXPLAIN) applies. */
  kind: EngineKind
  /** Engine groups objects under named schemas (postgres/mysql) vs a single default (sqlite). */
  supportsMultipleSchemas: boolean
  /** `INSERT ... RETURNING` is available. */
  supportsReturning: boolean
  /**
   * The driver can abort an in-flight statement when its `query` receives an aborted
   * `AbortSignal` (postgres/mysql/mssql). Synchronous engines (sqlite) run to
   * completion, so cancellation is best-effort (guarded only before the statement
   * starts) — the UI reads this flag instead of branching on `dialect`.
   */
  supportsCancel: boolean
  /** Default/implicit schema name used when a query omits one (e.g. 'main', 'public'). */
  defaultSchema: string
}

/** Build the live driver's public flags from the canonical manifest. Concrete adapters
 * do not repeat these declarations, so backend responses and disconnected UI metadata
 * describe the same engine. */
export function driverFlags(dialect: DbDialect): DriverFlags {
  const manifest = getDatabaseDriverManifest(dialect)
  return {
    dialect,
    kind: manifest.kind,
    supportsMultipleSchemas: manifest.capabilities.multipleSchemas,
    supportsReturning: manifest.capabilities.returning,
    supportsCancel: manifest.capabilities.queryCancel,
    defaultSchema: manifest.defaultSchema,
  }
}

export type DbObjectType = 'table' | 'view'

export type DbPostgresTablePrivilege =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'TRUNCATE'
  | 'REFERENCES'
  | 'TRIGGER'
  | 'MAINTAIN'

export type DbPostgresSequencePrivilege = 'USAGE' | 'SELECT' | 'UPDATE'

export interface DbPostgresPrivilegeGrant<TPrivilege extends string = DbPostgresTablePrivilege> {
  grantor: string
  /** Omitted for PostgreSQL's implicit PUBLIC pseudo-role. */
  grantee?: string
  privilege: TPrivilege
  grantable: boolean
}

export interface DbSequenceDefinition {
  schema: string
  name: string
  dataType: string
  start: string
  increment: string
  minValue: string
  maxValue: string
  cache: string
  cycle: boolean
  /** Explicit LOGGED identity override, needed when the owning table is UNLOGGED. */
  logged?: boolean
  unlogged?: boolean
  comment?: string
  /** PostgreSQL owner plus explicit sequence ACL; grants omitted means the default ACL. */
  postgresAccess?: {
    owner: string
    grants?: DbPostgresPrivilegeGrant<DbPostgresSequencePrivilege>[]
  }
}

export interface DbPostgresOption {
  name: string
  value: string
}

export interface DbPostgresPolicy {
  name: string
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  permissive: boolean
  roles: string[]
  using?: string
  withCheck?: string
}

export interface DbColumn {
  name: string
  /** Engine-reported type text, verbatim (e.g. 'INTEGER', 'varchar(255)'). */
  dataType: string
  /** Human-authored catalog comment, when the engine exposes one. */
  comment?: string
  nullable: boolean
  /** Member of the primary key. */
  pk: boolean
  /** Default expression as reported by the engine, if any. */
  defaultValue?: string | null
  /** PostgreSQL generated-column expression and storage kind. */
  generated?: {
    expression: string
    storage: 'STORED' | 'VIRTUAL'
  }
  /** PostgreSQL identity generation and its implicit sequence definition. */
  identity?: {
    generation: 'ALWAYS' | 'BY DEFAULT'
    sequence?: DbSequenceDefinition
  }
  /** PostgreSQL serial-style sequence owned by this column. */
  ownedSequence?: DbSequenceDefinition
  /** PostgreSQL 18+ catalog identity and inheritance state for this column's NOT NULL. */
  postgresNotNull?: {
    name: string
    validated: boolean
    noInherit?: boolean
    /** Cloned/inherited from a PostgreSQL parent; visible but not emitted again. */
    inherited?: boolean
  }
  /** PostgreSQL foreign-data-wrapper options attached to this column. */
  postgresForeignOptions?: DbPostgresOption[]
  /** PostgreSQL non-default collation, kept structurally for identifier-safe DDL. */
  postgresCollation?: {
    schema: string
    name: string
  }
  /** PostgreSQL TOAST/storage strategy when it differs from the data type default. */
  postgresStorage?: 'PLAIN' | 'EXTERNAL' | 'EXTENDED' | 'MAIN'
  /** PostgreSQL column compression method when explicitly selected. */
  postgresCompression?: 'pglz' | 'lz4'
  /** PostgreSQL per-column ANALYZE statistics target. */
  postgresStatistics?: number
  /** PostgreSQL planner options such as n_distinct and n_distinct_inherited. */
  postgresAttributeOptions?: DbPostgresOption[]
  /** SQL Server computed-column expression and whether its value is physically persisted. */
  sqlServerComputed?: {
    expression: string
    persisted: boolean
  }
  /** SQL Server IDENTITY generator, including its non-default catalog values. */
  sqlServerIdentity?: {
    seed: string
    increment: string
    notForReplication?: boolean
  }
  /** SQL Server system-time boundary generated by the engine. */
  sqlServerGeneratedAlways?: 'ROW START' | 'ROW END'
  /** A hidden SQL Server system-time boundary column. */
  sqlServerHidden?: boolean
  /** SQL Server Dynamic Data Masking function (for example `email()`). */
  sqlServerMaskingFunction?: string
  /** Catalog collation pinned to this SQL Server character column. */
  collation?: string
  /** SQL Server named DEFAULT constraint. */
  defaultConstraintName?: string
  /** SQL Server storage/semantic column attributes. */
  rowGuid?: boolean
  sparse?: boolean
  columnSet?: boolean
}

export type DbReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

export type DbForeignKeyMatch = 'SIMPLE' | 'FULL' | 'PARTIAL'

export interface DbForeignKey {
  /** Catalog constraint name, when the engine exposes it. */
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onUpdate?: DbReferentialAction
  onDelete?: DbReferentialAction
  /** PostgreSQL subset affected by ON DELETE SET NULL/DEFAULT. */
  onDeleteColumns?: string[]
  /** PostgreSQL match mode. SQLite accepts MATCH syntax but does not report/enforce it. */
  match?: DbForeignKeyMatch
  /** PostgreSQL transaction-timing attributes. */
  deferrable?: boolean
  initiallyDeferred?: boolean
  /** PostgreSQL validation state (`false` means an ALTER ... NOT VALID constraint). */
  validated?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** PostgreSQL 18 temporal/enforcement semantics. */
  period?: boolean
  enforced?: boolean
  /** SQL Server execution/optimizer state. */
  notForReplication?: boolean
  disabled?: boolean
  notTrusted?: boolean
}

export interface DbCheckConstraint {
  /** Catalog constraint name, when the engine exposes it. */
  name?: string
  /** Engine-reported boolean SQL expression. */
  expression: string
  /** PostgreSQL inheritance behavior. */
  noInherit?: boolean
  /** PostgreSQL 18+ enforcement state. */
  enforced?: boolean
  /** PostgreSQL validation state. */
  validated?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** SQL Server replication/state attributes. */
  notForReplication?: boolean
  disabled?: boolean
  notTrusted?: boolean
}

export interface DbKeyConstraint {
  name?: string
  type: 'PRIMARY KEY' | 'UNIQUE'
  columns: string[]
  /** PostgreSQL non-key payload columns. */
  includeColumns?: string[]
  /** PostgreSQL uniqueness/timing semantics. */
  nullsNotDistinct?: boolean
  deferrable?: boolean
  initiallyDeferred?: boolean
  withoutOverlaps?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** SQL Server key order and physical kind. */
  orders?: Array<'asc' | 'desc'>
  clustered?: boolean
}

export interface DbExclusionConstraint {
  name?: string
  /** PostgreSQL-native EXCLUDE clause from pg_get_constraintdef(). */
  definition: string
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
}

/** One index on a table — name, its ordered column list, and uniqueness/PK role. */
export interface DbIndex {
  name: string
  /** Indexed columns, in key order. */
  columns: string[]
  unique: boolean
  /** Backs the primary key (sqlite `origin==='pk'`, mysql `PRIMARY`, `indisprimary`, `is_primary_key`). */
  primary?: boolean
  /**
   * Backs a declared PRIMARY/UNIQUE constraint rather than a standalone CREATE INDEX.
   * Renderers keep it in structural metadata but must not emit a second physical index.
   */
  constraint?: boolean
  /** Key sort direction, aligned with `columns`; omitted when the engine does not expose it. */
  orders?: Array<'asc' | 'desc'>
  /** MySQL prefix lengths, aligned with `columns` (`null` means the complete value). */
  prefixLengths?: Array<number | null>
  /** Non-key payload columns from a SQL Server INCLUDE clause. */
  includeColumns?: string[]
  /** Engine-native predicate for a partial/filtered index. */
  predicate?: string
  /** SQL Server rowstore index kind. */
  clustered?: boolean
  /** Engine-native standalone CREATE INDEX when the catalog stores/reconstructs one exactly. */
  createScript?: string
  /**
   * The native CREATE is authoritative because structured fields cannot represent an
   * expression key, partial predicate, or another engine-specific index clause.
   */
  createScriptOnly?: boolean
  /** Index partition cloned/attached beneath a PostgreSQL parent index. */
  inherited?: boolean
}

/** One table/view trigger with an engine-native executable definition. */
export interface DbTrigger {
  name: string
  createScript: string
  /** The trigger exists, but its executable body is encrypted or hidden by metadata permissions. */
  definitionUnavailable?: boolean
  /** Engine-native session/context statements that must run immediately before CREATE. */
  preCreateScripts?: string[]
  /** Engine-native follow-up statements that restore context or non-default trigger state. */
  postCreateScripts?: string[]
}

/** One PostgreSQL rewrite rule with an engine-native executable definition. */
export interface DbRule {
  name: string
  createScript: string
  /** Follow-up statements that restore disabled/replica/always firing state. */
  postCreateScripts?: string[]
}

/** One PostgreSQL extended planner-statistics object attached to a relation. */
export interface DbPostgresExtendedStatistic {
  schema: string
  name: string
  /** Canonical CREATE STATISTICS from pg_get_statisticsobjdef(). */
  createScript: string
  owner: string
  /** Omitted means ALTER STATISTICS ... SET STATISTICS DEFAULT. Zero is meaningful. */
  statisticsTarget?: number
  comment?: string
}

/** Full structure of one table/view — the vocabulary for the schema browser + editor DDL context. */
export interface DbTableSchema {
  schema?: string
  name: string
  type: DbObjectType
  /** Human-authored catalog comment on the relation. */
  comment?: string
  columns: DbColumn[]
  primaryKey: string[]
  foreignKeys: DbForeignKey[]
  /** CHECK constraints when the engine requires reconstructed table DDL. */
  checkConstraints?: DbCheckConstraint[]
  /** Named PRIMARY KEY/UNIQUE constraints with semantics not captured by plain indexes. */
  keyConstraints?: DbKeyConstraint[]
  /** PostgreSQL EXCLUDE constraints, kept as canonical engine clauses. */
  exclusionConstraints?: DbExclusionConstraint[]
  /** SQL Server system-time period and optional system-versioned history table. */
  sqlServerTemporal?: {
    periodStart: string
    periodEnd: string
    systemVersioned: boolean
    historySchema?: string
    historyTable?: string
  }
  /** PostgreSQL-native partition key deparsed by pg_get_partkeydef(), e.g. `RANGE (created_at)`. */
  postgresPartitionBy?: string
  /** PostgreSQL declarative-partition parent, bound, and column state that differs from it. */
  postgresPartition?: {
    parentSchema: string
    parentTable: string
    /** pg_get_expr(relpartbound), e.g. `FOR VALUES FROM (...) TO (...)` or `DEFAULT`. */
    bound: string
    defaultOverrides?: Array<{ column: string; value: string | null }>
    /** Columns made NOT NULL locally while the corresponding parent column remains nullable. */
    notNullColumns?: string[]
  }
  /** PostgreSQL table inheritance, including local columns and inherited-column overrides. */
  postgresInheritance?: {
    /** Direct parents in pg_inherits.inhseqno order. */
    parents: Array<{ schema: string; table: string }>
    /** Columns defined locally (possibly also merged with an inherited declaration). */
    localColumns: string[]
    /** Defaults changed locally on otherwise purely inherited columns. */
    defaultOverrides?: Array<{ column: string; value: string | null }>
    /** Purely inherited columns made NOT NULL only on this child. */
    notNullColumns?: string[]
  }
  /** PostgreSQL physical/persistence clauses stored on pg_class. */
  postgresRelation?: {
    persistence?: 'UNLOGGED' | 'TEMPORARY'
    accessMethod?: string
    storageParameters?: string[]
    tablespace?: string
  }
  /** PostgreSQL typed-table dependency (`CREATE TABLE ... OF schema.type`). */
  postgresOfType?: {
    schema: string
    name: string
  }
  /** PostgreSQL foreign-table server dependency and FDW table options. */
  postgresForeign?: {
    server: string
    options?: DbPostgresOption[]
  }
  /** PostgreSQL row-level-security flags and policies, including disabled policy sets. */
  postgresRowSecurity?: {
    enabled: boolean
    forced: boolean
    policies: DbPostgresPolicy[]
  }
  /** PostgreSQL non-default logical-replication row identity. */
  postgresReplicaIdentity?: { mode: 'NOTHING' | 'FULL' } | { mode: 'INDEX'; index: string }
  /** PostgreSQL index selected for future parameterless CLUSTER operations. */
  postgresClusteredIndex?: string
  /** PostgreSQL multivariate/expression planner-statistics objects on this relation. */
  postgresExtendedStatistics?: DbPostgresExtendedStatistic[]
  /** PostgreSQL relation owner plus explicit table/column ACLs. */
  postgresAccess?: {
    owner: string
    /** Omitted when relacl is NULL (the default owner ACL); empty means an explicit empty ACL. */
    tableGrants?: DbPostgresPrivilegeGrant[]
    /** Present only for columns whose attacl is non-NULL. */
    columnGrants?: Array<{
      column: string
      grants: DbPostgresPrivilegeGrant[]
    }>
  }
  /** Indexes defined on the table (incl. the ones backing PK/unique constraints). */
  indexes: DbIndex[]
  /** Triggers attached to this table/view when the engine exposes executable native DDL. */
  triggers?: DbTrigger[]
  /** PostgreSQL user rewrite rules; the view implementation `_RETURN` rule is excluded. */
  rules?: DbRule[]
  /**
   * Approximate row count from the engine's cheap statistics (never `COUNT(*)`, which
   * would scan/lock large tables): postgres `pg_class.reltuples`, mysql
   * `information_schema.TABLES.TABLE_ROWS`, mssql `sys.dm_db_partition_stats`, sqlite
   * `sqlite_stat1` (present only after `ANALYZE`). OMITTED (undefined) when the engine
   * has no estimate yet, so the UI shows nothing rather than a misleading `0`.
   */
  approxRows?: number
  /** Native/reconstructed CREATE statement when the engine exposes a faithful definition. */
  createScript?: string
  /** The native CREATE already embeds standalone indexes (MySQL SHOW CREATE TABLE). */
  createScriptIncludesIndexes?: boolean
}

export interface DbSchemaItem {
  name: string
  type: DbObjectType
  /**
   * Optional short type tag shown as a pill in the sidebar tree — e.g. a Redis key's data
   * type (`str`/`list`/`hash`/`set`/`zset`/`stream`). Engine-agnostic display metadata; omitted
   * when the engine has no per-item type to surface.
   */
  badge?: string
  /**
   * Optional seconds-until-expiry, shown as a clock indicator in the tree (Redis keys with a
   * TTL). A point-in-time snapshot from introspection; omitted for items that never expire.
   */
  ttl?: number
}

/** schemaName → its tables/views. Single-schema engines report one key (the default schema). */
export type DbSchemas = Record<string, DbSchemaItem[]>

export interface DbResultColumn {
  name: string
  /** Best-effort declared type, when the engine exposes it. */
  type?: string
}

/** A query outcome. Row-returning statements fill `columns`+`rows`; DML fills `rowsAffected`. */
export interface DbResultSet {
  columns: DbResultColumn[]
  /** Row-major, cells in `columns` order. */
  rows: unknown[][]
  rowsAffected?: number
  lastInsertId?: number | string
  durationMs: number
  /**
   * The statement returned more than `RESULT_ROW_CAP` rows and `rows` holds only the first of
   * them (`shared/result-cap.ts`). Absent means the rows are the whole result.
   */
  truncated?: boolean
}

/** One statement in a {@link DbDriver.transaction} batch. */
export interface BatchStatement {
  sql: string
  params?: unknown[]
}

/** Structured, read-only object browse request. Unlike `query`, this is safe to expose
 * to generic workspace UI: concrete drivers translate it into SQL, collection reads,
 * index searches or key reads without accepting executable user text. */
export interface DbBrowseRequest {
  table: string
  schema?: string
  limit: number
  offset: number
  sort?: { column: string; direction: 'asc' | 'desc' }
}

/**
 * A manually-controlled, open transaction pinned to ONE real connection ("Tx: Manual"
 * mode). Unlike {@link DbDriver.transaction} (a self-contained atomic
 * batch), this stays open across several separate `query` calls until the caller
 * explicitly {@link DbTransaction.commit}s or {@link DbTransaction.rollback}s — every
 * `query` runs on the same pinned connection so reads see the uncommitted writes.
 * `commit`/`rollback` are idempotent (a second call is a no-op) and release the pinned
 * connection.
 */
export interface DbTransaction {
  /** Run one statement on the pinned connection (same signature as {@link DbDriver.query}). */
  query(sql: string, params?: unknown[], signal?: AbortSignal): Promise<DbResultSet>
  /** COMMIT the transaction and release the pinned connection. Idempotent. */
  commit(): Promise<void>
  /** ROLLBACK the transaction and release the pinned connection. Idempotent. */
  rollback(): Promise<void>
}

/** Run one statement — the {@link DbDriver.query} signature, bound to a pinned session. */
export type DbStatementRunner = DbTransaction['query']

/**
 * The port. A driver is constructed already-connected; the registry owns lifetime.
 * All methods are async so remote engines fit the same shape.
 */
export interface DbDriver {
  getFlags(): DriverFlags
  /**
   * The engine runs a multi-statement text as ONE unit with semantics that splitting would
   * break — a T-SQL batch scopes `DECLARE @x` to the batch and makes a procedure body the
   * rest of it. The service then sends such a text whole instead of statement by statement.
   */
  nativeScripts?: boolean
  /**
   * Run `work` with every statement on ONE physical session, so a script's session state
   * (variables, temp tables, a `BEGIN` written in the text) carries from one statement to
   * the next. OPTIONAL: a driver with a single connection and no interleaving risk, or an
   * engine without sessions (ClickHouse over HTTP), omits it and the service runs each
   * statement through `query`.
   */
  session?<T>(work: (run: DbStatementRunner) => Promise<T>, signal?: AbortSignal): Promise<T>
  /**
   * Ask the engine to COMPILE one statement without executing it (see `validation.ts`).
   * OPTIONAL: non-SQL engines and engines without a side-effect-free compile omit it. Must
   * never wait long behind a running user query and never disturb an open transaction.
   */
  validate?(sql: string, signal?: AbortSignal): Promise<DbValidation>
  /**
   * Run one SQL statement with optional positional params. An optional `AbortSignal`
   * requests cancellation of the in-flight statement — drivers that {@link DriverFlags.supportsCancel}
   * abort the running query; others honour it best-effort (before the statement starts).
   */
  query: (sql: string, params?: unknown[], signal?: AbortSignal) => Promise<DbResultSet>
  /**
   * Lightweight connectivity check used at connect + on health-check. OPTIONAL — when a
   * driver omits it, callers fall back to `query('SELECT 1')` (valid for SQL engines).
   * Non-SQL engines override it (e.g. Redis `PING`) so the probe carries no SQL assumption.
   */
  probe?(): Promise<void>
  /**
   * Run several statements as ONE atomic transaction (BEGIN…COMMIT, ROLLBACK on any error),
   * on a single pinned connection. Returns one result per statement, in input order.
   * OPTIONAL — when a driver omits it, atomic batches are unsupported and the service
   * rejects the batch before executing any statement.
   */
  transaction?(statements: BatchStatement[]): Promise<DbResultSet[]>
  /**
   * Open a MANUAL transaction pinned to one real connection ("Tx: Manual").
   * The returned handle routes subsequent `query` calls onto the pinned connection until
   * the caller commits/rolls back. OPTIONAL — only SQL engines implement it; non-SQL
   * drivers (redis/mongo/es) omit it and the service reports manual transactions as
   * unsupported.
   */
  beginTransaction?(): Promise<DbTransaction>
  /** Read one bounded page from a table/collection/index/key. `signal` cancels it exactly as
   *  it cancels `query` — a driver whose `query` honours it must pass it on. */
  browse(request: DbBrowseRequest, signal?: AbortSignal): Promise<DbResultSet>
  /** Enumerate schemas → tables/views. */
  schemas(): Promise<DbSchemas>
  /** Full structure of one object (columns, PK, FKs, create-script). */
  tableSchema(schema: string | undefined, table: string): Promise<DbTableSchema>
  /** Release underlying resources. Idempotent. */
  close(): Promise<void>
}
