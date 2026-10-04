/**
 * ClickHouse adapter over the official `@clickhouse/client`.
 *
 * The split reflected here: `query()` with a compact JSON format for statements that
 * return rows, `command()` for DDL/DML, and `system.*` tables for metadata.
 * ClickHouse-specific HTTP/TLS details stay inside this adapter;
 * the parent registry only sees the standard DbDriver port.
 */
import https from 'node:https'
import {
  createClient,
  type ClickHouseClient,
  type ClickHouseClientConfigOptions,
  type ResponseJSON,
} from '@clickhouse/client'
import JSONBig from 'json-bigint'
import { isReadOnlyStatementForDialect } from '../read-only/sql'
import { capRows, RESULT_ROW_CAP } from '../../shared/result-cap'
import { driverFlags } from './port'
import { buildSqlBrowseQuery } from './sql-browse'
import type { DbColumn, DbDriver, DbIndex, DbResultSet, DbSchemas, DbTableSchema } from './port'
import type { DriverConnInput } from './connection-input'
import {
  CLICKHOUSE_SQL_GRAMMAR,
  maskSqlNonCode,
  rewriteQuestionPlaceholders,
} from '../../shared/sql-regions'
import { recordArray } from '../../shared/safe-record'
import { clickHouseExplainText, clickHouseValidationFromError } from './clickhouse-validate'
import { boundedValidation } from './validation'

export type ClickHouseDriverOptions = DriverConnInput

/**
 * ClickHouse can emit Int64/UInt64 and Decimal values as bare JSON numbers (the integer
 * default changed in 25.8). Stock JSON.parse rounds them before the adapter sees either
 * their value or column metadata. Keep only numerically unsafe tokens as decimal strings;
 * ordinary integers/floats retain normal JavaScript number ergonomics.
 */
const exactClickHouseJson = JSONBig({
  storeAsString: true,
  // Parsed objects have a null prototype, so these remain safe own fields instead of
  // disappearing from JSON/Object columns returned by the database.
  protoAction: 'preserve',
  constructorAction: 'preserve',
})

export function parseClickHouseJsonExact<T = unknown>(json: string): T {
  return exactClickHouseJson.parse(json) as T
}

function unwrapClickHouseTypeCall(type: string, wrapper: string): string | undefined {
  const value = type.trim()
  const prefix = `${wrapper}(`
  if (!value.startsWith(prefix)) return undefined

  let depth = 1
  let quote = ''
  for (let index = prefix.length; index < value.length; index++) {
    const char = value[index]!
    if (quote) {
      if (char === '\\') {
        index++
      } else if (char === quote) {
        if (value[index + 1] === quote) index++
        else quote = ''
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
      if (depth === 0) {
        return index === value.length - 1 ? value.slice(prefix.length, index) : undefined
      }
    }
  }
  return undefined
}

function lastClickHouseTypeArgument(argumentsText: string): string {
  let depth = 0
  let quote = ''
  let lastComma = -1
  for (let index = 0; index < argumentsText.length; index++) {
    const char = argumentsText[index]!
    if (quote) {
      if (char === '\\') {
        index++
      } else if (char === quote) {
        if (argumentsText[index + 1] === quote) index++
        else quote = ''
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
    } else if (char === ',' && depth === 0) {
      lastComma = index
    }
  }
  return argumentsText.slice(lastComma + 1).trim()
}

/**
 * Whether a ClickHouse column can itself be NULL. Looking for Nullable anywhere is too
 * broad (`Array(Nullable(String))` only has nullable elements), while checking only the
 * outer wrapper misses two server-supported transparent wrappers. This mirrors the
 * server's `isNullable` behavior for stored column types.
 */
export function isClickHouseNullableType(type: string, depth = 0): boolean {
  if (depth > 8) return false
  if (unwrapClickHouseTypeCall(type, 'Nullable') !== undefined) return true

  const lowCardinality = unwrapClickHouseTypeCall(type, 'LowCardinality')
  if (lowCardinality !== undefined) {
    return isClickHouseNullableType(lowCardinality, depth + 1)
  }

  const simpleAggregate = unwrapClickHouseTypeCall(type, 'SimpleAggregateFunction')
  if (simpleAggregate !== undefined) {
    return isClickHouseNullableType(lastClickHouseTypeArgument(simpleAggregate), depth + 1)
  }
  return false
}

/**
 * ClickHouse's HTTP client needs `query()` for statements whose response body is a
 * result set and `command()` for statements with no useful body. This is deliberately
 * NOT the same question as "is this definitely read-only":
 *
 * - `SHOW CREATE TABLE` and `SHOW GRANTS` return rows but contain DDL keywords;
 * - `EXPLAIN AST ALTER ...` returns a plan without executing the ALTER;
 * - `KILL ... TEST` and ordinary KILL statements return status rows despite being
 *   operational commands;
 * - deprecated `WATCH` still builds a streaming result pipeline;
 * - `CHECK DATABASE`, on the other hand, returns no rows.
 *
 * The generic read-only classifier remains the security/guard-rail decision. The
 * ClickHouse-specific additions below only choose how the official HTTP client consumes
 * the response. All recognized output statements accept a trailing `FORMAT` clause,
 * which `client.query()` supplies as JSONCompact.
 */
export function isClickHouseRowQuery(sql: string): boolean {
  if (isReadOnlyStatementForDialect(sql, 'clickhouse')) return true

  const statements = maskSqlNonCode(sql, CLICKHOUSE_SQL_GRAMMAR)
    .split(';')
    .map((statement) => statement.replace(/^[\s(]+/, '').trim())
    .filter(Boolean)
  if (statements.length === 0) return false

  return statements.every((statement) => {
    // INTO OUTFILE redirects the response server-side, so there is no JSON body to parse.
    if (/\bINTO\s+OUTFILE\b/i.test(statement)) return false
    const first = /^[A-Za-z_][A-Za-z0-9_]*/.exec(statement)?.[0]?.toUpperCase()
    if (
      first === 'SHOW' ||
      first === 'EXPLAIN' ||
      first === 'DESCRIBE' ||
      first === 'DESC' ||
      first === 'EXISTS' ||
      first === 'KILL' ||
      first === 'WATCH'
    ) {
      return true
    }
    if (first !== 'CHECK') return false
    // CHECK TABLE / CHECK ALL TABLES and CHECK GRANT yield rows. CHECK DATABASE is
    // intentionally excluded because ClickHouse documents it as output-free.
    return /^CHECK\s+(?:TABLE\b|ALL\s+TABLES\b|GRANT\b)/i.test(statement)
  })
}

/**
 * The official client always appends its requested response format to `query()`. Passing
 * through a user's own output clause therefore produces `FORMAT CSV FORMAT JSONCompact`.
 * Keep the query semantics, but let the adapter control the wire representation it must
 * decode.
 *
 * Only a top-level FORMAT whose format name is at the statement tail (optionally before
 * SETTINGS) is removed. That keeps functions such as `format(...)`, quoted text/comments,
 * and ordinary columns named `format` untouched.
 */
export function stripClickHouseOutputFormat(sql: string): string {
  const code = maskSqlNonCode(sql, CLICKHOUSE_SQL_GRAMMAR)
  let depth = 0
  let formatSpan: { start: number; end: number } | undefined

  for (let index = 0; index < code.length; index++) {
    const ch = code[index]
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || !/[A-Za-z_]/.test(ch)) continue

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(index))?.[0]
    if (!word) continue
    const wordEnd = index + word.length
    if (word.toUpperCase() === 'FORMAT') {
      const formatNameStart = wordEnd + (code.slice(wordEnd).match(/^\s*/)?.[0].length ?? 0)
      const formatName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(formatNameStart))?.[0] ?? ''
      const formatNameEnd = formatNameStart + formatName.length
      const tail = code.slice(formatNameEnd)
      if (formatName && /^\s*(?:;?\s*$|SETTINGS\b)/i.test(tail)) {
        formatSpan = { start: index, end: formatNameEnd }
      }
    }
    index = wordEnd - 1
  }

  if (!formatSpan) return sql
  const before = sql.slice(0, formatSpan.start).trimEnd()
  const after = sql.slice(formatSpan.end).trimStart()
  if (!after) return before
  return after.startsWith(';') ? `${before}${after}` : `${before} ${after}`
}

function clickHouseParamType(value: unknown): string {
  if (value === null || value === undefined) return 'Nullable(String)'
  if (typeof value === 'boolean') return 'Bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int64' : 'Float64'
  if (typeof value === 'bigint') return 'Int64'
  return 'String'
}

/**
 * Rewrite portable positional `?` parameters into ClickHouse's typed `{pN:Type}` form.
 * Literal/comment skipping comes from the shared scanner (shared/sql-regions) so this and
 * the MSSQL binder cannot drift apart again — the hand-rolled copy that used to live here
 * is what bound a `?` sitting inside an escaped string. `[…]` is NOT an identifier in
 * ClickHouse (it is an array literal), which is exactly why the grammar is a parameter.
 * Values remain out-of-band in `query_params`.
 */
export function bindClickHouseParams(
  sql: string,
  params: unknown[],
): { query: string; queryParams: Record<string, unknown> } {
  if (params.length === 0) return { query: sql, queryParams: {} }
  return {
    query: rewriteQuestionPlaceholders(
      sql,
      params.length,
      CLICKHOUSE_SQL_GRAMMAR,
      (index) => `{p${index}:${clickHouseParamType(params[index])}}`,
    ),
    queryParams: Object.fromEntries(params.map((value, paramIndex) => [`p${paramIndex}`, value])),
  }
}

function normalizedUrl(options: ClickHouseDriverOptions): string {
  if (options.url) {
    // WHATWG URL refuses to mutate a non-special scheme (`clickhouse:`) into a special
    // one (`http:`), leaving the original protocol in place. Rewrite the raw scheme
    // before parsing so both manifest aliases reach the official HTTP client.
    const rewritten = options.url
      .replace(/^clickhouses:/i, 'https:')
      .replace(/^clickhouse:/i, 'http:')
    const url = new URL(rewritten)
    const urlWasSecure = url.protocol === 'https:'
    const secure = options.ssl === undefined ? urlWasSecure : options.ssl !== false
    const explicitPort = url.port ? Number(url.port) : undefined
    const priorDefaultPort = urlWasSecure ? 8443 : 8123
    const defaultPort = secure ? 8443 : 8123

    // The official client chooses HTTP vs HTTPS solely from the URL. A separate ssl
    // override therefore has to move the scheme too; otherwise a custom https.Agent can
    // be paired with an http:// URL. ClickHouse's HTTP endpoints default to 8123/8443,
    // not WHATWG's protocol defaults 80/443. Preserve genuinely custom ports.
    url.protocol = secure ? 'https:' : 'http:'
    if (
      explicitPort === undefined ||
      (secure !== urlWasSecure && explicitPort === priorDefaultPort)
    ) {
      url.port = String(defaultPort)
    }
    return url.toString()
  }
  const secure = options.ssl !== undefined && options.ssl !== false
  const protocol = secure ? 'https' : 'http'
  return `${protocol}://${options.host ?? 'localhost'}:${options.port ?? (secure ? 8443 : 8123)}`
}

export function buildClickHouseClientConfig(
  options: ClickHouseDriverOptions,
): ClickHouseClientConfigOptions {
  const url = normalizedUrl(options)
  const config: ClickHouseClientConfigOptions = {
    url,
    application: 'Localix',
    request_timeout: 30_000,
    max_open_connections: 2,
    json: { parse: parseClickHouseJsonExact },
    ...(options.user ? { username: options.user } : {}),
    ...(options.password ? { password: options.password } : {}),
    ...(options.database ? { database: options.database } : {}),
  }
  const ssl = options.ssl
  if (ssl && typeof ssl === 'object') {
    // ClickHouse ignores its `tls` block whenever `http_agent` is present. Put the WHOLE
    // Node TLS shape on one agent so rejectUnauthorized cannot accidentally discard a CA
    // or client identity, and so mTLS can use the platform CA set without a custom CA.
    config.http_agent = new https.Agent({
      keepAlive: true,
      maxSockets: 2,
      ...(ssl.rejectUnauthorized !== undefined
        ? { rejectUnauthorized: ssl.rejectUnauthorized }
        : {}),
      ...(ssl.ca ? { ca: Buffer.from(ssl.ca) } : {}),
      ...(ssl.cert ? { cert: Buffer.from(ssl.cert) } : {}),
      ...(ssl.key ? { key: Buffer.from(ssl.key) } : {}),
    })
    // The native ClickHouse mTLS path sets these headers itself. A custom agent bypasses
    // that path, so mirror it when a complete client identity is present.
    if (ssl.cert && ssl.key) {
      const parsedUrl = new URL(url)
      const username =
        options.user ?? (parsedUrl.username ? decodeURIComponent(parsedUrl.username) : 'default')
      const password =
        options.password ?? (parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '')
      config.set_basic_auth_header = false
      config.http_headers = {
        'X-ClickHouse-User': username,
        'X-ClickHouse-Key': password,
        'X-ClickHouse-SSL-Certificate-Auth': 'on',
      }
    }
  }
  return config
}

/**
 * The row cap, applied by the SERVER: ClickHouse stops producing a result past
 * `max_result_rows` and, with `result_overflow_mode = 'break'`, returns what it has instead of
 * failing. Only row queries carry it — a `command()` returns no rows to cap.
 */
export const CAPPED_RESULT_SETTINGS = {
  max_result_rows: String(RESULT_ROW_CAP + 1),
  result_overflow_mode: 'break',
} as const

export function createClickHouseDriver(options: ClickHouseDriverOptions): DbDriver {
  const client: ClickHouseClient = createClient(buildClickHouseClientConfig(options))
  const flags = driverFlags('clickhouse')
  let closed = false

  async function query(
    sql: string,
    params: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<DbResultSet> {
    signal?.throwIfAborted()
    const start = performance.now()
    if (isClickHouseRowQuery(sql)) {
      const bound = bindClickHouseParams(stripClickHouseOutputFormat(sql), params)
      const result = await client.query({
        query: bound.query,
        query_params: bound.queryParams,
        format: 'JSONCompact',
        abort_signal: signal,
        clickhouse_settings: CAPPED_RESULT_SETTINGS,
      })
      const payload = await result.json<unknown[]>()
      const json = payload as ResponseJSON<unknown[]>
      // `break` stops at a BLOCK boundary, so the body may run past cap+1 by up to one block;
      // the slice makes the cap exact, the server setting keeps the body bounded.
      const { rows, truncated } = capRows(json.data as unknown[][])
      return {
        columns: (json.meta ?? []).map((column) => ({ name: column.name, type: column.type })),
        rows,
        durationMs: performance.now() - start,
        ...(truncated ? { truncated } : {}),
      }
    }
    const bound = bindClickHouseParams(sql, params)
    const result = await client.command({
      query: bound.query,
      query_params: bound.queryParams,
      abort_signal: signal,
    })
    const written = Number(result.summary?.written_rows ?? 0)
    return {
      columns: [],
      rows: [],
      rowsAffected: Number.isFinite(written) ? written : undefined,
      durationMs: performance.now() - start,
    }
  }

  const browse: DbDriver['browse'] = (request, signal) =>
    query(buildSqlBrowseQuery('clickhouse', request), undefined, signal)

  async function objectRows<T extends Record<string, unknown>>(
    sql: string,
    queryParams: Record<string, unknown> = {},
  ): Promise<T[]> {
    const result = await client.query({
      query: sql,
      query_params: queryParams,
      format: 'JSONEachRow',
    })
    return (await result.json<T>()) as T[]
  }

  /** Parse-only check (see clickhouse-validate.ts); only a syntax error is a verdict. */
  const validate: NonNullable<DbDriver['validate']> = (sql, signal) =>
    boundedValidation(async (bounded) => {
      try {
        await client.command({ query: clickHouseExplainText(sql), abort_signal: bounded })
        return { ok: true }
      } catch (err) {
        return clickHouseValidationFromError(sql, err)
      }
    }, signal)

  async function probe(): Promise<void> {
    const result = await client.ping({ select: true })
    if (!result.success) throw result.error
  }

  async function schemas(): Promise<DbSchemas> {
    const rows = await objectRows<{
      database: string
      name: string
      engine: string
    }>(
      `SELECT database, name, engine
       FROM system.tables
       WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
       ORDER BY database, name`,
    )
    const output: DbSchemas = {}
    for (const row of rows) {
      recordArray(output, row.database).push({
        name: row.name,
        type: row.engine.endsWith('View') ? 'view' : 'table',
      })
    }
    return output
  }

  async function tableSchema(schema: string | undefined, table: string): Promise<DbTableSchema> {
    const selectedDatabase = schema || flags.defaultSchema
    const [columnRows, tableRows] = await Promise.all([
      objectRows<{
        name: string
        type: string
        default_expression: string
        is_in_primary_key: number | string
      }>(
        `SELECT name, type, default_expression, is_in_primary_key
         FROM system.columns
         WHERE database = {database:String} AND table = {table:String}
         ORDER BY position`,
        { database: selectedDatabase, table },
      ),
      objectRows<{
        engine: string
        total_rows: number | string | null
        primary_key: string
        create_table_query: string
      }>(
        `SELECT engine, total_rows, primary_key, create_table_query
         FROM system.tables
         WHERE database = {database:String} AND name = {table:String}
         LIMIT 1`,
        { database: selectedDatabase, table },
      ),
    ])
    const primaryKey: string[] = []
    const columns: DbColumn[] = []
    for (const column of columnRows) {
      const pk = Number(column.is_in_primary_key) === 1
      if (pk) primaryKey.push(column.name)
      columns.push({
        name: column.name,
        dataType: column.type,
        nullable: isClickHouseNullableType(column.type),
        pk,
        defaultValue: column.default_expression || null,
      })
    }
    const tableRow = tableRows[0]
    const indexes: DbIndex[] =
      primaryKey.length > 0
        ? [
            {
              name: `${table}_primary_key`,
              columns: primaryKey,
              unique: false,
              primary: true,
            },
          ]
        : []
    const rawEstimate = tableRow?.total_rows
    const estimate = rawEstimate == null ? Number.NaN : Number(rawEstimate)

    return {
      schema: selectedDatabase,
      name: table,
      type: tableRow?.engine.endsWith('View') ? 'view' : 'table',
      columns,
      primaryKey,
      foreignKeys: [],
      indexes,
      approxRows: Number.isFinite(estimate) && estimate >= 0 ? estimate : undefined,
      createScript: tableRow?.create_table_query || undefined,
    }
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    await client.close()
  }

  return {
    getFlags: () => flags,
    query,
    validate,
    probe,
    browse,
    schemas,
    tableSchema,
    close,
  }
}
