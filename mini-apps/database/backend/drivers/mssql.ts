/**
 * Microsoft SQL Server driver over the `mssql` package (pure-JS tedious TDS). Lazily
 * connects a pool on first use (the service validates with `SELECT 1` at connect).
 * Introspection via `INFORMATION_SCHEMA` (see ./mssql-introspect). Positional `?`
 * params are rewritten to namespaced `@__localix_pN` parameters (the console rarely uses params, but
 * validation/DML may). Pool-config building lives in ./mssql-config.
 */
import { makeManualTransaction } from './manual-transaction'
import { MSSQL_COLUMN_CATALOG_SQL, readColumnCatalog } from './column-catalog'
import sql from 'mssql'
import { driverFlags } from './port'
import { buildSqlBrowseQuery } from './sql-browse'
import type {
  BatchStatement,
  DbDriver,
  DbResultSet,
  DbSchemas,
  DbTableSchema,
  DbTransaction,
} from './port'
import type { DriverConnInput } from './connection-input'
import { buildMssqlPoolConfig } from './mssql-config'
import { mssqlSchemas, mssqlTableSchema } from './mssql-introspect'
import { MSSQL_SQL_GRAMMAR, rewriteQuestionPlaceholders } from '../../shared/sql-regions'
import { acquireUnlessAborted } from './acquire-unless-aborted'
import { isReadOnlyStatementForDialect } from '../read-only/sql'
import { streamMssqlRows, type MssqlCollected, type MssqlStreamingRequest } from './mssql-rows'
import {
  isStandaloneMssqlDdl,
  MSSQL_DESCRIBE_QUERY,
  mssqlDescribeText,
  mssqlValidationFromRows,
} from './mssql-validate'
import { boundedValidation } from './validation'

export { buildMssqlPoolConfig } from './mssql-config'

/**
 * Rewrite positional `?` params to namespaced T-SQL parameters, skipping any `?` that is
 * inside a string literal, a `[bracket]` identifier or a comment. node-mssql reserves
 * `@p{n}` for its own prepared-statement internals, so the adapter must not generate that
 * otherwise tempting spelling.
 *
 * Extracted from the driver closure so it is testable: it previously did a bare
 * `text.replace(/\?/g, …)`, which bound the `?` in `note = 'why?'` and then handed the
 * REAL placeholder `params[1]` — a value that does not exist. That produced no error, just
 * a query matching `note = 'why<value>'`, so the user silently got the wrong rows.
 */
export function bindMssqlParams(
  text: string,
  params: unknown[],
): { text: string; names: string[] } {
  if (params.length === 0) return { text, names: [] }
  const names = params.map((_value, index) => `__localix_p${index}`)
  return {
    text: rewriteQuestionPlaceholders(
      text,
      params.length,
      MSSQL_SQL_GRAMMAR,
      (index) => `@${names[index]}`,
    ),
    names,
  }
}

export type MssqlDriverOptions = DriverConnInput

export function createMssqlDriver(options: MssqlDriverOptions): DbDriver {
  const pool = new sql.ConnectionPool(buildMssqlPoolConfig(options))
  let connecting: Promise<sql.ConnectionPool> | null = null
  const getPool = (): Promise<sql.ConnectionPool> => (connecting ??= pool.connect())

  const flags = driverFlags('mssql')
  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('mssql', request), undefined, signal)

  /** Bind positional params in the adapter namespace and rewrite each CODE-level `?` in order. */
  function prepare(req: sql.Request, text: string, params: unknown[]): string {
    const { text: rewritten, names } = bindMssqlParams(text, params)
    names.forEach((name, index) => req.input(name, params[index] as never))
    return rewritten
  }

  async function query(
    text: string,
    params: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<DbResultSet> {
    const start = performance.now()
    // Connecting the lazy pool can outlive the request timeout. Re-check after that await
    // so an already-cancelled statement never starts on the newly available pool.
    const p = await acquireUnlessAborted(getPool, signal)
    const req = p.request()
    req.arrayRowMode = true
    // The mssql Request exposes `.cancel()` which sends an attention/cancel packet; the
    // awaited query then rejects with a RequestError (code ECANCEL, "Cancelled.").
    const onAbort = () => {
      req.cancel()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      // A standalone read may be ended early past the row cap (see mssql-rows).
      const mayStop = isReadOnlyStatementForDialect(text, 'mssql')
      return shape(await run(req, text, params, mayStop), start)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Stream one request through the row cap (`mssql-rows.ts`). */
  function run(req: sql.Request, text: string, params: unknown[], mayStop: boolean) {
    return streamMssqlRows(
      req as unknown as MssqlStreamingRequest,
      prepare(req, text, params),
      mayStop,
    )
  }

  /** Normalize a streamed request: the first recordset (capped) or DML counts. */
  function shape(collected: MssqlCollected, start: number): DbResultSet {
    if (collected.columns) {
      return {
        columns: collected.columns.map((col) => ({ name: col.name })),
        rows: collected.rows,
        durationMs: performance.now() - start,
        ...(collected.truncated ? { truncated: true } : {}),
      }
    }
    return {
      columns: [],
      rows: [],
      rowsAffected: collected.rowsAffected,
      durationMs: performance.now() - start,
    }
  }

  // Atomic batch: an mssql Transaction owns one pooled connection; each statement runs on a
  // Request bound to it. COMMIT on success, ROLLBACK on any error.
  async function transaction(statements: BatchStatement[]): Promise<DbResultSet[]> {
    const p = await getPool()
    const tx = new sql.Transaction(p)
    await tx.begin()
    try {
      const out: DbResultSet[] = []
      for (const s of statements) {
        const req = new sql.Request(tx)
        req.arrayRowMode = true
        const start = performance.now()
        out.push(shape(await run(req, s.sql, s.params ?? [], false), start))
      }
      await tx.commit()
      return out
    } catch (err) {
      await tx.rollback().catch(() => {})
      throw err
    }
  }

  // Manual transaction: an mssql Transaction owns one pooled connection for its lifetime;
  // each query runs on a Request bound to it until commit/rollback. Cancel of an in-flight
  // tx statement sends an attention packet via the Request's `.cancel()`.
  async function beginTransaction(): Promise<DbTransaction> {
    const p = await getPool()
    const tx = new sql.Transaction(p)
    await tx.begin()
    return makeManualTransaction({
      async query(
        text: string,
        params: unknown[] = [],
        signal?: AbortSignal,
      ): Promise<DbResultSet> {
        signal?.throwIfAborted()
        const start = performance.now()
        const req = new sql.Request(tx)
        req.arrayRowMode = true
        const onAbort = () => {
          req.cancel()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        try {
          // Inside a transaction nothing is cut off by the cap — it drains (see mssql-rows).
          return shape(await run(req, text, params, false), start)
        } finally {
          signal?.removeEventListener('abort', onAbort)
        }
      },
      commit: () => tx.commit(),
      rollback: () => tx.rollback(),
    })
  }

  /** Compile-only check through the describe DMF (see mssql-validate.ts). */
  const validate: NonNullable<DbDriver['validate']> = (text, signal) =>
    boundedValidation(async (bounded) => {
      if (isStandaloneMssqlDdl(text)) return { ok: true, skipped: 'unsupported' }
      const p = await acquireUnlessAborted(getPool, bounded)
      const req = p.request()
      req.input('tsql', sql.NVarChar(sql.MAX), mssqlDescribeText(text))
      // A DMF compile can wait on a schema lock held by the user's open transaction.
      const onAbort = () => req.cancel()
      bounded.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await req.query(MSSQL_DESCRIBE_QUERY)
        return mssqlValidationFromRows(
          (result.recordset ?? []) as unknown as Parameters<typeof mssqlValidationFromRows>[0],
        )
      } catch {
        // The check itself failed (pre-2012 server, lost connection): no verdict on the SQL.
        return { ok: true, skipped: 'unsupported' }
      } finally {
        bounded.removeEventListener('abort', onAbort)
      }
    }, signal)

  async function objectRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
    const p = await getPool()
    const req = p.request()
    const r = await req.query(prepare(req, text, params))
    return (r.recordset ?? []) as unknown as T[]
  }

  const schemas = (): Promise<DbSchemas> => mssqlSchemas(objectRows)

  const columnCatalog = () => readColumnCatalog(objectRows, MSSQL_COLUMN_CATALOG_SQL)

  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    mssqlTableSchema(objectRows, schema ?? flags.defaultSchema, table)

  async function close(): Promise<void> {
    await pool.close().catch(() => {})
  }

  return {
    getFlags: () => flags,
    // A T-SQL batch scopes `DECLARE @x` and temp tables to itself (the pool resets the
    // connection between requests), and a procedure body runs to the batch's end, so a
    // script is sent whole rather than statement by statement.
    nativeScripts: true,
    query,
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
