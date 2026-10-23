/**
 * PostgreSQL driver over postgres.js. Lazily connects on first query (the service
 * validates with a `SELECT 1` at connect time). Introspection via `information_schema`
 * lives in ./postgres-introspect, mapped onto the dialect-agnostic schema shape.
 */
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import { makeManualTransaction } from './manual-transaction'
import { PG_COLUMN_CATALOG_SQL, readColumnCatalog } from './column-catalog'
import postgres from 'postgres'
import { isSingleReadStatementForDialect } from '../read-only/sql'
import { driverFlags } from './port'
import { collectPgRows, type PgRowSource } from './postgres-rows'
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
import { pgSchemas, pgTableSchema } from './postgres-introspect'
import { acquireUnlessAborted } from './acquire-unless-aborted'
import { compilePgStatement } from './postgres-validate'
import { boundedValidation } from './validation'

export type PostgresDriverOptions = DriverConnInput

/** How long the compile check rests after its connection failed or timed out. */
const VALIDATOR_REST_MS = 30_000

/** Build the options object that accompanies both postgres.js URL and field connections. */
export function buildPostgresOptions(
  options: PostgresDriverOptions,
): postgres.Options<Record<string, postgres.PostgresType>> {
  return {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_MS / 1000,
    onnotice: () => {},
    ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
    ...(!options.url
      ? {
          host: options.host,
          port: options.port,
          username: options.user,
          password: options.password,
          database: options.database,
        }
      : {}),
  }
}

/**
 * Shape a postgres.js `.values()` result into a {@link DbResultSet}. In `.values()` mode a
 * row-returning query comes back as a row-major array of POSITIONAL cell arrays with a
 * `columns` sidecar; a DML statement carries a `count`. Rows are already positional, so
 * duplicate column names survive — a JOIN's two `id` columns, or `SELECT 1 AS x, 2 AS x`,
 * would collapse to the last value if we re-keyed each row by column name. Pure + exported
 * so the duplicate-column guarantee is unit-tested without a live server.
 */
export function shapePgValuesResult(
  res: unknown,
  durationMs: number,
  collected?: { rows: unknown[][]; truncated: boolean },
): DbResultSet {
  const cols = ((res as { columns?: Array<{ name: string }> }).columns ?? []).map((c) => ({
    name: c.name,
  }))
  if (cols.length > 0) {
    return {
      columns: cols,
      rows: collected?.rows ?? (res as unknown[][]),
      durationMs,
      ...(collected?.truncated ? { truncated: true } : {}),
    }
  }
  return { columns: [], rows: [], rowsAffected: (res as { count?: number }).count ?? 0, durationMs }
}

/** What `runCapped` needs of the pool, a `begin` transaction or a reserved connection. */
interface PgExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe(query: string, parameters?: any[]): { values(): unknown }
}

/**
 * Run one statement text on `executor` holding at most the row cap (`postgres-rows.ts` says how
 * each shape stops or drains). `.cancel()` stays on the pending query for the abort signal.
 *
 * `close` is the pool's `sql.CLOSE` — one module-level sentinel, which a `begin` transaction's
 * handle carries at runtime but not in its typings, so it is passed rather than read off `tx`.
 */
async function runCapped(
  executor: PgExecutor,
  close: unknown,
  text: string,
  params: unknown[],
  signal: AbortSignal | undefined,
): Promise<DbResultSet> {
  signal?.throwIfAborted()
  const start = performance.now()
  // `.values()` → POSITIONAL rows (see `shapePgValuesResult`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = executor.unsafe(text, params as any[]).values()
  // postgres.js pending queries expose `.cancel()`, which opens a side connection to send a
  // protocol-level cancel request (best-effort; the awaited query then rejects).
  const onAbort = () => {
    ;(pending as unknown as { cancel?: () => void }).cancel?.()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const collected = await collectPgRows(
      pending as unknown as PgRowSource,
      isSingleReadStatementForDialect(text, 'postgres'),
      close,
    )
    return shapePgValuesResult(collected.result, performance.now() - start, collected)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function createPostgresDriver(options: PostgresDriverOptions): DbDriver {
  // postgres.js takes a URL string OR an options object with discrete fields. Its `ssl`
  // option accepts a boolean or a Node TLS options object directly — our `ssl` shape maps
  // straight through in BOTH URL and field modes (omit it when unset so the URL/client
  // defaults remain authoritative).
  const postgresOptions = buildPostgresOptions(options)
  const sql = options.url ? postgres(options.url, postgresOptions) : postgres(postgresOptions)

  const flags = driverFlags('postgres')
  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('postgres', request), undefined, signal)

  const query = (text: string, params: unknown[] = [], signal?: AbortSignal) =>
    runCapped(sql, sql.CLOSE, text, params, signal)

  // A script's statements share one reserved connection, so `SET`, temp tables and a
  // `BEGIN` written in the text reach the statements after them.
  const session: NonNullable<DbDriver['session']> = async (work, signal) => {
    const reserved = await acquireUnlessAborted(
      () => sql.reserve(),
      signal,
      (r) => r.release(),
    )
    try {
      return await work((text, params = [], s) => runCapped(reserved, sql.CLOSE, text, params, s))
    } finally {
      reserved.release()
    }
  }

  // The compile check's own connection (see postgres-validate.ts): never the user's
  // session, so a Parse error cannot abort their open transaction, and `prepare: false`
  // so no named statement is left behind per validated text. Opened on first use; after a
  // connection failure the check rests instead of redialling on every keystroke.
  let validator: postgres.Sql | undefined
  let validatorRestUntil = 0
  const validate: NonNullable<DbDriver['validate']> = (text, signal) =>
    boundedValidation(async (bounded) => {
      if (Date.now() < validatorRestUntil) return { ok: true, skipped: 'busy' }
      const validatorOptions = { ...postgresOptions, prepare: false, idle_timeout: 60 }
      validator ??= options.url
        ? postgres(options.url, validatorOptions)
        : postgres(validatorOptions)
      const verdict = await compilePgStatement(validator, text, bounded)
      if (verdict.ok && verdict.skipped) validatorRestUntil = Date.now() + VALIDATOR_REST_MS
      return verdict
    }, signal)

  // Atomic batch: postgres.js `begin` pins a connection and auto-ROLLBACKs if the callback
  // throws (COMMIT otherwise). Statements run in order; results are shaped like `query`.
  async function transaction(statements: BatchStatement[]): Promise<DbResultSet[]> {
    return (await sql.begin(async (tx) => {
      const out: DbResultSet[] = []
      for (const s of statements) {
        out.push(await runCapped(tx, sql.CLOSE, s.sql, s.params ?? [], undefined))
      }
      return out
    })) as DbResultSet[]
  }

  // Manual transaction: `reserve()` pins one connection out of the pool for the life of
  // the transaction; BEGIN/queries/COMMIT/ROLLBACK all run on it, then `release()` returns
  // it. (Note: this driver's pool is max:1, so schema-browser queries on the SAME driver
  // wait until the transaction releases — acceptable; a manual tx is a focused session.)
  async function beginTransaction(): Promise<DbTransaction> {
    const reserved = await sql.reserve()
    try {
      await reserved.unsafe('BEGIN')
    } catch (err) {
      reserved.release()
      throw err
    }
    return makeManualTransaction({
      query: (text, params = [], signal) => runCapped(reserved, sql.CLOSE, text, params, signal),
      commit: async () => {
        await reserved.unsafe('COMMIT')
      },
      rollback: async () => {
        await reserved.unsafe('ROLLBACK')
      },
      release: () => reserved.release(),
    })
  }

  async function rows<T>(text: string, params: unknown[] = []): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await sql.unsafe(text, params as any[])) as unknown as T[]
  }

  const schemas = (): Promise<DbSchemas> => pgSchemas(rows)

  const columnCatalog = () => readColumnCatalog(rows, PG_COLUMN_CATALOG_SQL)

  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    pgTableSchema(rows, schema ?? flags.defaultSchema, table)

  async function close(): Promise<void> {
    await Promise.all([sql.end({ timeout: 5 }), validator?.end({ timeout: 1 })])
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
