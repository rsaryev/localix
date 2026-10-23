/**
 * Agnostic database-driver port. One narrow interface every SQL engine implements;
 * the UI and autocomplete never branch on engine type — they read `DriverFlags`
 * (capability descriptor) and the normalized schema/result shapes below.
 *
 * The server-side port leaves connection and transport lifecycle to each concrete driver:
 * there is no `connect()` method here, and the port assumes only an asynchronous `query`.
 */

import type { DbColumnCatalog } from './column-catalog'
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

import type { DbSchemas, DbTableSchema } from './schema-table-contracts'

export type {
  DbPostgresTablePrivilege,
  DbPostgresSequencePrivilege,
  DbPostgresPrivilegeGrant,
  DbSequenceDefinition,
  DbPostgresOption,
  DbPostgresPolicy,
  DbColumn,
} from './schema-column-contracts'
export type {
  DbReferentialAction,
  DbForeignKeyMatch,
  DbForeignKey,
  DbCheckConstraint,
  DbKeyConstraint,
  DbExclusionConstraint,
  DbIndex,
  DbTrigger,
  DbRule,
  DbPostgresExtendedStatistic,
} from './schema-object-contracts'
export type { DbTableSchema, DbSchemaItem, DbSchemas } from './schema-table-contracts'
export type { DbCatalogColumn, DbCatalogTable, DbColumnCatalog } from './column-catalog'

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
  /**
   * Every table's column names in one catalog read (see `column-catalog.ts`). OPTIONAL: a driver
   * that omits it leaves the UI to read columns table by table.
   */
  columnCatalog?(): Promise<DbColumnCatalog>
  /** Full structure of one object (columns, PK, FKs, create-script). */
  tableSchema(schema: string | undefined, table: string): Promise<DbTableSchema>
  /** Release underlying resources. Idempotent. */
  close(): Promise<void>
}
