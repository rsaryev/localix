/**
 * SQLite driver over Bun's built-in `bun:sqlite` — zero extra dependencies.
 * Introspection via PRAGMA + `sqlite_schema`. Row-returning statements come back as
 * `values()` (row-major arrays) so large result sets stay compact on the wire.
 */
import { makeManualTransaction } from './manual-transaction'
import { Database, type Statement } from 'bun:sqlite'
import { driverFlags } from './port'
import { readSqliteRows } from './sqlite-rows'
import { buildSqlBrowseQuery } from './sql-browse'
import { createExclusiveQueue } from './exclusive-queue'
import { createSqliteIntrospection } from './sqlite-introspect'
import { compileSqliteStatement } from './sqlite-validate'
import { exactJsonInteger } from '../../shared/exact-json'
import type {
  BatchStatement,
  DbDriver,
  DbResultSet,
  DbSchemas,
  DbTableSchema,
  DbTransaction,
} from './port'

export interface SqliteDriverOptions {
  /** Path to the database file. `:memory:` for an ephemeral in-memory db. */
  file: string
  /** Open without write access. */
  readonly?: boolean
}

/** Keep SQLite's exact 64-bit integers while retaining ordinary JSON number ergonomics. */
function normalizeSqliteValue(value: unknown): unknown {
  if (typeof value === 'bigint') return exactJsonInteger(value)
  // Uint8Array itself JSON-stringifies as {"0":…}; Buffer's standard toJSON shape is
  // recognized by the result adapter while remaining a Uint8Array for direct agent tools.
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value)
  return value
}

export function createSqliteDriver(options: SqliteDriverOptions): DbDriver {
  const db = new Database(options.file, {
    readonly: options.readonly,
    create: !options.readonly,
    // Bun otherwise converts every INTEGER to Number and truncates it to 52 bits.
    safeIntegers: true,
  })
  db.exec('PRAGMA foreign_keys = ON;')

  // bun:sqlite is synchronous, therefore the shared manifest declares cancellation as
  // best-effort only (guarded before execution).
  const flags = driverFlags('sqlite')
  const queue = createExclusiveQueue()

  /** A read's real column names, repeats suffixed by SQLite (`id:1`); see `sqlite-rows.ts`. */
  function probeColumnNames(sql: string, params: unknown[]): string[] | null {
    try {
      const probe = db.prepare(`SELECT * FROM (${sql.trim().replace(/;\s*$/, '')}) LIMIT 0`)
      try {
        probe.values(...(params as never[]))
        return probe.columnNames ?? null
      } finally {
        probe.finalize()
      }
    } catch {
      return null
    }
  }

  async function queryUnlocked(
    sql: string,
    params: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<DbResultSet> {
    signal?.throwIfAborted()
    const start = performance.now()
    // Console SQL is unbounded and may contain DDL. `Database.query()` keeps a cached
    // prepared statement alive; after schema introspection those cached PRAGMA/select
    // statements can hold a schema lock and make the next ALTER/DROP fail with
    // "database table is locked". Prepare per execution and always finalize instead.
    const stmt: Statement = db.prepare(sql)
    try {
      const columnNames = stmt.columnNames ?? []
      if (columnNames.length > 0) {
        const { rows, truncated, columns } = readSqliteRows(stmt, columnNames, params, sql, () =>
          probeColumnNames(sql, params),
        )
        return {
          columns: columns.map((name) => ({ name })),
          rows: rows.map((row) => row.map(normalizeSqliteValue)),
          durationMs: performance.now() - start,
          ...(truncated ? { truncated } : {}),
        }
      }
      const info = stmt.run(...(params as never[]))
      return {
        columns: [],
        rows: [],
        rowsAffected: info.changes,
        lastInsertId: normalizeSqliteValue(info.lastInsertRowid) as number | string,
        durationMs: performance.now() - start,
      }
    } finally {
      stmt.finalize()
    }
  }

  const query: DbDriver['query'] = (sql, params, signal) =>
    queue.run(() => queryUnlocked(sql, params, signal), signal)
  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('sqlite', request), undefined, signal)
  // A script holds the one lease for all its statements, so no other caller's statement
  // can land inside a `BEGIN … COMMIT` written in the script's own text.
  const session: NonNullable<DbDriver['session']> = (work, signal) =>
    queue.run(() => work(queryUnlocked), signal)
  // Never waits: while a query or a manual transaction holds the connection there is no
  // verdict, rather than a check stuck behind the user's own work.
  const validate: NonNullable<DbDriver['validate']> = async (sql) =>
    (await queue.tryRun(() => compileSqliteStatement(db, sql))) ?? { ok: true, skipped: 'busy' }

  // Atomic batch on the single bun:sqlite connection: BEGIN, run each statement via the
  // unlocked executor, COMMIT — or ROLLBACK if any throws. Hold one exclusive lease over
  // the whole sequence so another request can neither join this transaction nor nest BEGIN.
  async function transaction(statements: BatchStatement[]): Promise<DbResultSet[]> {
    return queue.run(async () => {
      db.exec('BEGIN')
      try {
        const out: DbResultSet[] = []
        for (const s of statements) out.push(await queryUnlocked(s.sql, s.params ?? []))
        db.exec('COMMIT')
        return out
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* rollback best-effort */
        }
        throw err
      }
    })
  }

  // Manual transaction on the single bun:sqlite handle: BEGIN, route queries through the
  // unlocked executor, then COMMIT/ROLLBACK. Its lease stays held for the transaction's
  // lifetime, so ordinary queries/schema reads wait rather than leaking into its BEGIN.
  async function beginTransaction(): Promise<DbTransaction> {
    const release = await queue.acquire()
    try {
      db.exec('BEGIN')
    } catch (err) {
      release()
      throw err
    }
    return makeManualTransaction({
      query: queryUnlocked,
      commit: () => {
        db.exec('COMMIT')
      },
      rollback: () => {
        db.exec('ROLLBACK')
      },
      release,
    })
  }

  const { schemasUnlocked, tableSchemaUnlocked } = createSqliteIntrospection(db)

  const schemas = (): Promise<DbSchemas> => queue.run(schemasUnlocked)
  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    queue.run(() => tableSchemaUnlocked(schema, table))

  async function close(): Promise<void> {
    await queue.run(() => db.close(false))
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
    tableSchema,
    close,
  }
}
