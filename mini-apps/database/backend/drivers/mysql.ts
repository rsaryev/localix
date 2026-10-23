/**
 * MySQL / MariaDB driver over mysql2. Lazily connects via a pool (the service
 * validates with a `SELECT 1` at connect time). Introspection via `information_schema`
 * lives in ./mysql-introspect. A MySQL connection is scoped to one database, so the
 * schema tree groups under it.
 */
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import { makeManualTransaction } from './manual-transaction'
import { MYSQL_COLUMN_CATALOG_SQL, readColumnCatalog } from './column-catalog'
import mysql from 'mysql2/promise'
import { driverFlags } from './port'
import { buildSqlBrowseQuery } from './sql-browse'
import type {
  BatchStatement,
  DbDriver,
  DbResultSet,
  DbSchemas,
  DbStatementRunner,
  DbTableSchema,
  DbTransaction,
} from './port'
import type { DriverConnInput } from './connection-input'
import { mysqlSchemas, mysqlTableSchema } from './mysql-introspect'
import type { MysqlCollected } from './mysql-rows'
import {
  runAbortableMysqlStatement,
  runAbortableMysqlTransactionStatement,
  runMysqlStatement,
  type StreamingPoolConnection,
} from './mysql-statement'
import { acquireUnlessAborted } from './acquire-unless-aborted'
import { compileMysqlStatement } from './mysql-validate'
import { SERVER_READ_ONLY_STATEMENT } from '../read-only/server-guard'
import { boundedValidation } from './validation'

export type MysqlDriverOptions = DriverConnInput & {
  /** The connection is marked read-only: every pooled session is made read-only. */
  readonly?: boolean
}

/** The slice of a mysql2 pool the read-only hook needs (structural, for tests). */
export interface MysqlConnectionEvents {
  on(
    event: 'connection',
    listener: (connection: {
      query(sql: string, callback: (err: unknown) => void): unknown
    }) => void,
  ): unknown
}

/**
 * Make EVERY session the pool opens read-only, not only the one that happened to run the
 * connect-time switch.
 *
 * `applyServerReadOnly` runs `SET SESSION TRANSACTION READ ONLY` once through `query()`, which
 * reaches one pooled connection. mysql2 opens more under concurrency (measured: of three
 * concurrent reads, two reported `@@transaction_read_only = 0`) and replaces a connection that
 * a Stop or the row cap destroyed — so the server guarantee the UI reported quietly held for
 * one session in several. mysql2 emits `connection` for each new session before handing it
 * out, and commands on a connection run in order, so the switch lands before any user query.
 */
export function enforceReadOnlySessions(pool: MysqlConnectionEvents): void {
  pool.on('connection', (connection) => {
    // A rejection is reported by the connect-time `applyServerReadOnly`; nothing to add here.
    connection.query(SERVER_READ_ONLY_STATEMENT.mysql!, () => {})
  })
}

type MysqlExecutor = Pick<mysql.PoolConnection, 'query' | 'execute'>

/** Run a catalog SELECT as name-keyed rows. User queries deliberately use positional
 * rows to preserve duplicate labels; introspection instead reads stable aliases such as
 * `TABLE_NAME` and `COLUMN_NAME`, so applying `rowsAsArray` there discards every field. */
export async function runMysqlObjectRows<T>(
  executor: MysqlExecutor,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const options = { sql: text }
  const [result] =
    params.length === 0
      ? await executor.query(options)
      : await executor.execute({ ...options, values: params })
  return result as T[]
}

/** Build one pool config for URL and field modes without giving up exact BIGINT values. */
export function buildMysqlPoolOptions(options: MysqlDriverOptions): mysql.PoolOptions {
  const ssl = options.ssl
  const mysqlSsl = ssl === true ? {} : ssl && typeof ssl === 'object' ? ssl : undefined
  return {
    ...(options.url
      ? { uri: options.url }
      : {
          host: options.host,
          port: options.port,
          user: options.user,
          password: options.password,
          database: options.database,
        }),
    // mysql2 accepts an `ssl` override alongside `uri`; keeping this outside the branch
    // prevents a pasted URL from silently discarding a custom CA or client identity.
    ...(mysqlSsl !== undefined ? { ssl: mysqlSsl } : {}),
    // mysql2 otherwise converts BIGINT to Number even when it cannot be represented.
    // With this flag it keeps safe values as numbers and returns unsafe values as strings.
    supportBigNumbers: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
  }
}

export function createMysqlDriver(options: MysqlDriverOptions): DbDriver {
  // mysql2 takes a URL string OR a config object. Its `ssl` option is an object (or a named
  // profile string) — a bare `true` isn't accepted, so map boolean `true` → `{}` (enable
  // with defaults) and our object shape → mysql2's ssl object; omit when unset.
  const pool = mysql.createPool(buildMysqlPoolOptions(options))
  if (options.readonly) enforceReadOnlySessions(pool.pool as unknown as MysqlConnectionEvents)

  const flags = driverFlags('mysql')
  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('mysql', request), undefined, signal)

  async function query(
    text: string,
    params: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<DbResultSet> {
    const start = performance.now()
    // Pin the request so abort can destroy this exact connection without affecting any
    // other pooled work or racing a delayed KILL QUERY against a reused server thread.
    const conn = await acquireUnlessAborted(
      () => pool.getConnection(),
      signal,
      (acquired) => acquired.release(),
    )
    try {
      return shape(
        await runAbortableMysqlStatement(
          conn as unknown as StreamingPoolConnection,
          text,
          params,
          signal,
        ),
        start,
      )
    } finally {
      conn.release()
    }
  }

  /** Normalize a streamed statement: capped rows (+ fields) for reads, the header for DML. */
  function shape(collected: MysqlCollected, start: number): DbResultSet {
    if (collected.fields) {
      return {
        columns: collected.fields.map((f) => ({ name: f.name })),
        rows: collected.rows,
        durationMs: performance.now() - start,
        ...(collected.truncated ? { truncated: true } : {}),
      }
    }
    return {
      columns: [],
      rows: [],
      rowsAffected: collected.header?.affectedRows ?? 0,
      lastInsertId: collected.header?.insertId || undefined,
      durationMs: performance.now() - start,
    }
  }

  // Atomic batch: pin one pooled connection, BEGIN, run each statement, COMMIT — ROLLBACK on
  // any error. mysql2 has no multi-connection cancel here, so this runs to completion or fails.
  async function transaction(statements: BatchStatement[]): Promise<DbResultSet[]> {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const out: DbResultSet[] = []
      for (const s of statements) {
        const start = performance.now()
        const streaming = conn as unknown as StreamingPoolConnection
        out.push(shape(await runMysqlStatement(streaming, s.sql, s.params ?? []), start))
      }
      await conn.commit()
      return out
    } catch (err) {
      await conn.rollback().catch(() => {})
      throw err
    } finally {
      conn.release()
    }
  }

  // Manual transaction: pin one pooled connection, BEGIN, and route each query onto it
  // until commit/rollback releases it. Cancel of an in-flight tx statement uses the same
  // cross-connection `KILL QUERY <threadId>` trick as `query`.
  async function beginTransaction(): Promise<DbTransaction> {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
    } catch (err) {
      conn.release()
      throw err
    }
    return makeManualTransaction({
      query: pinnedRunner(conn),
      commit: () => conn.commit(),
      rollback: () => conn.rollback(),
      release: () => conn.release(),
    })
  }

  /** One statement on a pinned connection whose abort KILLs the query, never the connection. */
  function pinnedRunner(conn: mysql.PoolConnection): DbStatementRunner {
    const threadId = conn.threadId
    return async (text, params = [], signal) => {
      const start = performance.now()
      const collected = await runAbortableMysqlTransactionStatement(
        conn as unknown as StreamingPoolConnection,
        (id) => pool.query('KILL QUERY ?', [id]),
        threadId,
        text,
        params,
        signal,
      )
      return shape(collected, start)
    }
  }

  // A script pins one pooled connection: without it, `SET @x = 1; SELECT @x` or a
  // `BEGIN … COMMIT` written in the text could land on different server sessions.
  const session: NonNullable<DbDriver['session']> = async (work, signal) => {
    const conn = await acquireUnlessAborted(
      () => pool.getConnection(),
      signal,
      (acquired) => acquired.release(),
    )
    try {
      return await work(pinnedRunner(conn))
    } finally {
      conn.release()
    }
  }

  // Compile-only check on its own pooled connection (see mysql-validate.ts), so it never
  // waits on or joins the connection a manual transaction has pinned.
  const validate: NonNullable<DbDriver['validate']> = (text, signal) =>
    boundedValidation(async (bounded) => {
      const conn = await acquireUnlessAborted(
        () => pool.getConnection(),
        bounded,
        (acquired) => acquired.release(),
      )
      try {
        return await compileMysqlStatement(conn, text)
      } finally {
        conn.release()
      }
    }, signal)

  async function objectRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
    return runMysqlObjectRows<T>(pool, text, params)
  }

  const schemas = (): Promise<DbSchemas> => mysqlSchemas(objectRows)

  const columnCatalog = () => readColumnCatalog(objectRows, MYSQL_COLUMN_CATALOG_SQL)

  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    mysqlTableSchema(objectRows, schema, table)

  async function close(): Promise<void> {
    await pool.end()
  }

  return {
    getFlags: () => flags,
    query,
    session,
    validate,
    transaction,
    beginTransaction,
    browse,
    schemas,
    columnCatalog,
    tableSchema,
    close,
  }
}
