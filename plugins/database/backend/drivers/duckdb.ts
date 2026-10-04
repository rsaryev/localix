/**
 * DuckDB adapter over the current primary Node API (`@duckdb/node-api`).
 *
 * The database instance and one connection stay open for the lifetime of the Localix
 * connection. DuckDB's JSON converter is used for result cells so 64-bit integers,
 * dates, lists and structs remain JSON-safe on the plugin wire.
 */
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api'
import { maskSqlNonCode, POSTGRES_SQL_GRAMMAR } from '../../shared/sql-regions'
import { recordArray } from '../../shared/safe-record'
import { capRows, RESULT_ROW_CAP } from '../../shared/result-cap'
import { isReadOnlyStatementForDialect } from '../read-only/sql'
import { driverFlags } from './port'
import { buildSqlBrowseQuery } from './sql-browse'
import { createExclusiveQueue } from './exclusive-queue'
import { compileDuckDbStatement } from './duckdb-validate'
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

export interface DuckDbDriverOptions {
  file: string
  readonly?: boolean
}

type JsonRow = Record<string, unknown>

function normalizeDuckValue(value: unknown, jsonValue: unknown): unknown {
  // `getRowsJson()` is the exact representation for DECIMAL, TIME and microsecond
  // timestamps. `getRowsJS()` has already rounded those into Number/Date values, but it
  // is the only representation that keeps BLOB bytes distinguishable from text.
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'bigint') {
    if (typeof jsonValue === 'string' && !/^-?\d+$/.test(jsonValue)) return jsonValue
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : jsonValue
  }
  if (value instanceof Date) return jsonValue
  if (Array.isArray(value))
    return value.map((item, index) =>
      normalizeDuckValue(item, Array.isArray(jsonValue) ? jsonValue[index] : undefined),
    )
  if (value && typeof value === 'object') {
    const jsonObject =
      jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue)
        ? (jsonValue as Record<string, unknown>)
        : {}
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDuckValue(item, jsonObject[key])]),
    )
  }
  return jsonValue
}

function zipRow(names: string[], row: unknown[]): JsonRow {
  return Object.fromEntries(names.map((name, index) => [name, row[index]]))
}

function normalizedDuckRows(result: {
  getRowsJS(): unknown[][]
  getRowsJson(): unknown[][]
}): unknown[][] {
  const jsonRows = result.getRowsJson()
  return result
    .getRowsJS()
    .map((row, rowIndex) =>
      row.map((value, columnIndex) => normalizeDuckValue(value, jsonRows[rowIndex]?.[columnIndex])),
    )
}

function namesFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function duckDbIndexColumns(sql: string): string[] {
  // Split on code-level commas only. A quoted identifier may itself contain a comma and
  // an index expression may contain nested argument lists; `.split(',')` corrupts both.
  const code = maskSqlNonCode(sql, POSTGRES_SQL_GRAMMAR)
  const open = code.indexOf('(')
  const close = code.lastIndexOf(')')
  if (open < 0 || close <= open) return []

  const rawColumns = sql.slice(open + 1, close)
  const columnCode = code.slice(open + 1, close)
  const parts: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < columnCode.length; index++) {
    if (columnCode[index] === '(') depth++
    else if (columnCode[index] === ')') depth = Math.max(0, depth - 1)
    else if (columnCode[index] === ',' && depth === 0) {
      parts.push(rawColumns.slice(start, index))
      start = index + 1
    }
  }
  parts.push(rawColumns.slice(start))

  return parts
    .map((part) => {
      const trimmed = part.trim()
      const quoted = /^"((?:""|[^"])*)"$/.exec(trimmed)
      return quoted ? quoted[1]!.replace(/""/g, '"') : trimmed
    })
    .filter(Boolean)
}

export function createDuckDbDriver(options: DuckDbDriverOptions): DbDriver {
  const flags = driverFlags('duckdb')
  let closed = false
  let instance: DuckDBInstance | undefined
  let connection: DuckDBConnection | undefined
  let opening: Promise<DuckDBConnection> | undefined
  const queue = createExclusiveQueue()

  // Match the other Localix adapters: construction is synchronous and the first probe/query
  // opens the native connection. The generic registry and service never need an async
  // special-case for one driver library.
  async function getConnection(): Promise<DuckDBConnection> {
    if (closed) throw new Error('DuckDB connection is closed.')
    if (connection) return connection
    return (opening ??= (async () => {
      instance = await DuckDBInstance.create(
        options.file,
        options.readonly ? { access_mode: 'READ_ONLY' } : undefined,
      )
      connection = await instance.connect()
      return connection
    })())
  }

  async function queryOn(
    target: DuckDBConnection,
    sql: string,
    params: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<DbResultSet> {
    signal?.throwIfAborted()
    const start = performance.now()
    const onAbort = () => target.interrupt()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      // A read streams only until one row past the cap is in hand (DuckDB reads whole chunks, so
      // at most one chunk more). A write is read in full and capped afterwards: an abandoned
      // stream of an `INSERT … RETURNING` is not a result shape worth trading correctness for.
      const result = isReadOnlyStatementForDialect(sql, 'duckdb')
        ? await target.streamAndReadUntil(sql, RESULT_ROW_CAP + 1, params as DuckDBValue[])
        : await target.runAndReadAll(sql, params as DuckDBValue[])
      const { rows, truncated } = capRows(normalizedDuckRows(result))
      return {
        columns: result
          .columnNames()
          .map((name, index) => ({ name, type: result.columnType(index).toString() })),
        rows,
        rowsAffected: result.rowsChanged || undefined,
        durationMs: performance.now() - start,
        ...(truncated ? { truncated } : {}),
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  const queryUnlocked: DbDriver['query'] = async (sql, params, signal) =>
    queryOn(await getConnection(), sql, params, signal)
  const query: DbDriver['query'] = (sql, params, signal) =>
    queue.run(() => queryUnlocked(sql, params, signal), signal)
  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('duckdb', request), undefined, signal)
  // One lease for a whole script: nothing else can interleave on the single connection.
  const session: NonNullable<DbDriver['session']> = (work, signal) =>
    queue.run(() => work(queryUnlocked), signal)
  // Never waits behind a running query or an open manual transaction (see sqlite.ts).
  const validate: NonNullable<DbDriver['validate']> = async (sql) =>
    (await queue.tryRun(async () => compileDuckDbStatement(await getConnection(), sql))) ?? {
      ok: true,
      skipped: 'busy',
    }

  async function objectRowsUnlocked<T extends JsonRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await (await getConnection()).runAndReadAll(sql, params as DuckDBValue[])
    const names = result.columnNames()
    return normalizedDuckRows(result).map((row) => zipRow(names, row) as T)
  }

  async function transaction(statements: BatchStatement[]): Promise<DbResultSet[]> {
    return queue.run(async () => {
      await queryUnlocked('BEGIN')
      try {
        const results: DbResultSet[] = []
        for (const statement of statements) {
          results.push(await queryUnlocked(statement.sql, statement.params ?? []))
        }
        await queryUnlocked('COMMIT')
        return results
      } catch (error) {
        await queryUnlocked('ROLLBACK').catch(() => {})
        throw error
      }
    })
  }

  async function beginTransaction(): Promise<DbTransaction> {
    const release = await queue.acquire()
    try {
      await queryUnlocked('BEGIN')
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
          await queryUnlocked('COMMIT')
        } catch (err) {
          await queryUnlocked('ROLLBACK').catch(() => {})
          throw err
        } finally {
          release()
        }
      },
      async rollback() {
        if (done) return
        done = true
        try {
          await queryUnlocked('ROLLBACK').catch(() => {})
        } finally {
          release()
        }
      },
    }
  }

  async function schemasUnlocked(): Promise<DbSchemas> {
    const rows = await objectRowsUnlocked<{
      table_schema: string
      table_name: string
      table_type: string
    }>(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
       ORDER BY table_schema, table_name`,
    )
    const output: DbSchemas = {}
    for (const row of rows) {
      recordArray(output, row.table_schema).push({
        name: row.table_name,
        type: row.table_type.includes('VIEW') ? 'view' : 'table',
      })
    }
    return output
  }

  async function tableSchemaUnlocked(
    schema: string | undefined,
    table: string,
  ): Promise<DbTableSchema> {
    const selectedSchema = schema || flags.defaultSchema
    // One DuckDBConnection processes one statement at a time. These small catalog reads stay
    // under the outer exclusive lease and run sequentially instead of racing one another on
    // the native handle.
    const columnRows = await objectRowsUnlocked<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
      [selectedSchema, table],
    )
    const constraintRows = await objectRowsUnlocked<{
      constraint_name: string | null
      constraint_type: string
      constraint_column_names: unknown
      referenced_table: string | null
      referenced_column_names: unknown
    }>(
      `SELECT constraint_name, constraint_type, constraint_column_names,
                referenced_table, referenced_column_names
         FROM duckdb_constraints()
         WHERE schema_name = ? AND table_name = ?`,
      [selectedSchema, table],
    )
    const indexRows = await objectRowsUnlocked<{
      index_name: string
      is_unique: boolean
      is_primary: boolean
      sql: string
    }>(
      `SELECT index_name, is_unique, is_primary, sql
         FROM duckdb_indexes()
         WHERE schema_name = ? AND table_name = ?`,
      [selectedSchema, table],
    )
    const tableRows = await objectRowsUnlocked<{
      estimated_size: number | string | null
      sql: string | null
    }>(
      `SELECT estimated_size, sql
         FROM duckdb_tables()
         WHERE schema_name = ? AND table_name = ?
         LIMIT 1`,
      [selectedSchema, table],
    )
    const typeRows = await objectRowsUnlocked<{ table_type: string }>(
      `SELECT table_type
         FROM information_schema.tables
         WHERE table_schema = ? AND table_name = ?
         LIMIT 1`,
      [selectedSchema, table],
    )

    const primaryKey = constraintRows.flatMap((row) =>
      row.constraint_type === 'PRIMARY KEY' ? namesFrom(row.constraint_column_names) : [],
    )
    const primarySet = new Set(primaryKey)
    const columns: DbColumn[] = columnRows.map((column) => ({
      name: column.column_name,
      dataType: column.data_type,
      nullable: column.is_nullable === 'YES',
      pk: primarySet.has(column.column_name),
      defaultValue: column.column_default,
    }))
    const foreignKeys: DbForeignKey[] = []
    const constraintIndexes: DbIndex[] = []
    for (const row of constraintRows) {
      if (row.constraint_type === 'FOREIGN KEY' && row.referenced_table) {
        foreignKeys.push({
          ...(row.constraint_name ? { name: row.constraint_name } : {}),
          columns: namesFrom(row.constraint_column_names),
          refSchema: selectedSchema,
          refTable: row.referenced_table,
          refColumns: namesFrom(row.referenced_column_names),
        })
      }
      if (row.constraint_type === 'PRIMARY KEY' || row.constraint_type === 'UNIQUE') {
        constraintIndexes.push({
          name:
            row.constraint_name ||
            `${table}_${row.constraint_type === 'PRIMARY KEY' ? 'pkey' : 'unique'}`,
          columns: namesFrom(row.constraint_column_names),
          unique: true,
          primary: row.constraint_type === 'PRIMARY KEY',
          constraint: true,
        })
      }
    }
    const indexes: DbIndex[] = [...constraintIndexes]
    const constraintIndexNames = new Set(constraintIndexes.map((index) => index.name))
    for (const index of indexRows) {
      if (constraintIndexNames.has(index.index_name)) continue
      indexes.push({
        name: index.index_name,
        columns: duckDbIndexColumns(index.sql),
        unique: index.is_unique,
        primary: index.is_primary,
        createScript: index.sql,
      })
    }
    const rawEstimate = tableRows[0]?.estimated_size
    const estimate = rawEstimate == null ? Number.NaN : Number(rawEstimate)

    return {
      schema: selectedSchema,
      name: table,
      type: typeRows[0]?.table_type.includes('VIEW') ? 'view' : 'table',
      columns,
      primaryKey,
      foreignKeys,
      indexes,
      approxRows: Number.isFinite(estimate) && estimate >= 0 ? estimate : undefined,
      createScript: tableRows[0]?.sql || undefined,
    }
  }

  const schemas = (): Promise<DbSchemas> => queue.run(schemasUnlocked)
  const tableSchema = (schema: string | undefined, table: string): Promise<DbTableSchema> =>
    queue.run(() => tableSchemaUnlocked(schema, table))

  async function close(): Promise<void> {
    await queue.run(async () => {
      if (closed) return
      closed = true
      await opening?.catch(() => {})
      connection?.closeSync()
      instance?.closeSync()
      connection = undefined
      instance = undefined
    })
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
