/**
 * SQLite driver over Bun's built-in `bun:sqlite` — zero extra dependencies.
 * Introspection via PRAGMA + `sqlite_schema`. Row-returning statements come back as
 * `values()` (row-major arrays) so large result sets stay compact on the wire.
 */
import { Database, type Statement } from 'bun:sqlite'
import { driverFlags } from './port'
import { readSqliteRows } from './sqlite-rows'
import { buildSqlBrowseQuery } from './sql-browse'
import { createExclusiveQueue } from './exclusive-queue'
import { normalizeReferentialAction } from './fk-rows'
import { compileSqliteStatement } from './sqlite-validate'
import { quoteIdent as quoteSqlIdent } from '../sql-ident'
import { exactJsonInteger } from '../../shared/exact-json'
import type {
  BatchStatement,
  DbColumn,
  DbDriver,
  DbForeignKey,
  DbIndex,
  DbResultSet,
  DbSchemas,
  DbTableSchema,
  DbTransaction,
} from './port'

/** Double-quote a SQLite identifier for interpolation into PRAGMA calls (which can't be parametrized). */
const quoteIdent = (name: string): string => quoteSqlIdent(name, 'sqlite')

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

const sqliteNumber = (value: number | bigint): number => Number(value)

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
    let done = false
    return {
      query: queryUnlocked,
      async commit() {
        if (done) return
        done = true
        try {
          db.exec('COMMIT')
        } catch (err) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* rollback best-effort */
          }
          throw err
        } finally {
          release()
        }
      },
      async rollback() {
        if (done) return
        done = true
        try {
          db.exec('ROLLBACK')
        } catch {
          /* rollback best-effort */
        } finally {
          release()
        }
      },
    }
  }

  async function schemasUnlocked(): Promise<DbSchemas> {
    const rows = db
      .query(
        `SELECT name, type FROM sqlite_schema
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string; type: 'table' | 'view' }>
    return { main: rows.map((r) => ({ name: r.name, type: r.type })) }
  }

  async function tableSchemaUnlocked(
    _schema: string | undefined,
    table: string,
  ): Promise<DbTableSchema> {
    const info = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string
      type: string
      notnull: number | bigint
      pk: number | bigint
      dflt_value: string | null
    }>
    const columns: DbColumn[] = info.map((c) => ({
      name: c.name,
      dataType: c.type,
      // SQLite reports `notnull = 0` for `INTEGER PRIMARY KEY`, even though a primary
      // key cannot be NULL. Normalize that semantic invariant for every UI consumer.
      nullable: sqliteNumber(c.pk) === 0 && sqliteNumber(c.notnull) === 0,
      pk: sqliteNumber(c.pk) > 0,
      defaultValue: c.dflt_value,
    }))
    const primaryKey = info
      .filter((c) => sqliteNumber(c.pk) > 0)
      .sort((a, b) => sqliteNumber(a.pk) - sqliteNumber(b.pk))
      .map((c) => c.name)

    const fkRows = db.query(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as Array<{
      id: number | bigint
      from: string
      to: string | null
      table: string
      seq: number | bigint
      on_update: string
      on_delete: string
    }>
    const fkById = new Map<number, DbForeignKey>()
    for (const r of fkRows.sort(
      (a, b) =>
        sqliteNumber(a.id) - sqliteNumber(b.id) || sqliteNumber(a.seq) - sqliteNumber(b.seq),
    )) {
      const id = sqliteNumber(r.id)
      const existing = fkById.get(id)
      if (existing) {
        existing.columns.push(r.from)
        if (r.to !== null) existing.refColumns.push(r.to)
      } else {
        fkById.set(id, {
          columns: [r.from],
          refTable: r.table,
          refColumns: r.to === null ? [] : [r.to],
          onUpdate: normalizeReferentialAction(r.on_update),
          onDelete: normalizeReferentialAction(r.on_delete),
        })
      }
    }

    const objType = db
      .query(`SELECT type, sql FROM sqlite_schema WHERE name = ? LIMIT 1`)
      .get(table) as { type: 'table' | 'view'; sql: string | null } | null

    // sqlite_schema.sql is authoritative for explicit indexes, including expression keys
    // and partial predicates that the normalized DbIndex fields cannot fully represent.
    // Keep those indexes for exact DDL export, but mark their structured fields as display
    // hints so mutation planners never reconstruct a wider/different index from them.
    const idxList = db.query(`PRAGMA index_list(${quoteIdent(table)})`).all() as Array<{
      name: string
      unique: number | bigint
      origin: string // 'pk' | 'u' | 'c'
      partial: number | bigint
    }>
    const indexes: DbIndex[] = idxList.flatMap((idx) => {
      const cols = db.query(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as Array<{
        seqno: number | bigint
        cid: number | bigint
        name: string | null
      }>
      const indexScript =
        idx.origin === 'c'
          ? (
              db
                .query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1`)
                .get(idx.name) as { sql: string | null } | null
            )?.sql
          : null
      const hasExpression = cols.some(
        (column) => sqliteNumber(column.cid) === -2 || column.name === null,
      )
      const createScriptOnly = sqliteNumber(idx.partial) === 1 || hasExpression
      if (createScriptOnly && !indexScript) return []
      const orderedColumns = cols.sort((a, b) => sqliteNumber(a.seqno) - sqliteNumber(b.seqno))
      return [
        {
          name: idx.name,
          // A partial index still has an exact physical key list. For expression indexes,
          // an incomplete list would be misleading, so the native definition stands alone.
          columns: hasExpression ? [] : orderedColumns.map((column) => column.name as string),
          unique: sqliteNumber(idx.unique) === 1,
          primary: idx.origin === 'pk',
          ...(idx.origin === 'u' ? { constraint: true } : {}),
          ...(indexScript ? { createScript: indexScript } : {}),
          ...(createScriptOnly ? { createScriptOnly: true } : {}),
        },
      ]
    })
    const triggers = (
      db
        .query(
          `SELECT name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
         ORDER BY name`,
        )
        .all(table) as Array<{ name: string; sql: string }>
    ).map((trigger) => ({
      name: trigger.name,
      createScript: trigger.sql,
    }))

    return {
      name: table,
      type: objType?.type ?? 'table',
      columns,
      primaryKey,
      foreignKeys: [...fkById.values()],
      indexes,
      ...(triggers.length ? { triggers } : {}),
      approxRows: approxRowCount(table),
      createScript: objType?.sql ?? undefined,
    }
  }

  const schemas = (): Promise<DbSchemas> => queue.run(schemasUnlocked)
  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    queue.run(() => tableSchemaUnlocked(schema, table))

  /**
   * SQLite has no cheap live row estimate. The only free source is `sqlite_stat1`
   * (populated by `ANALYZE`): its `stat` text starts with the estimated row count.
   * Absent stats table or row ⇒ undefined (never run `COUNT(*)`, which scans the table).
   */
  function approxRowCount(table: string): number | undefined {
    try {
      const row = db.query(`SELECT stat FROM sqlite_stat1 WHERE tbl = ? LIMIT 1`).get(table) as {
        stat: string | null
      } | null
      const first = row?.stat?.trim().split(/\s+/)[0]
      const n = first ? Number(first) : Number.NaN
      return Number.isFinite(n) && n >= 0 ? n : undefined
    } catch {
      // No sqlite_stat1 table (never ANALYZEd) — omit rather than scan.
      return undefined
    }
  }

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
