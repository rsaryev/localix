import type {
  DbColumn,
  DbPostgresOption,
  DbPostgresPolicy,
  DbPostgresPrivilegeGrant,
} from './schema-column-contracts'
import type {
  DbForeignKey,
  DbCheckConstraint,
  DbKeyConstraint,
  DbExclusionConstraint,
  DbIndex,
  DbTrigger,
  DbRule,
  DbPostgresExtendedStatistic,
} from './schema-object-contracts'

export type DbObjectType = 'table' | 'view'

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
