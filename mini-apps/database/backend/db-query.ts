import { z } from 'zod'
import { classifyQueryText } from './database-tool-schema'
import { defineAgentTool } from '@localixai/agent/agents'
import { DATABASE_DRIVERS, isDatabaseDialect } from '../shared/driver-catalog'
import { resolveAgentDatabaseConnection } from './agent-connection'

/**
 * Narrow port the tool needs from the database service — the mini app's `register()`
 * (backend/index.ts) adapts the shared service to it, so the tool depends only on
 * this shape and stays trivially testable with a fake.
 */
export interface DbQueryPort {
  listConnections(
    userId: string,
  ): Promise<
    Array<{ id: string; name: string; dialect: string; connected: boolean; readonly: boolean }>
  >
  runQuery(
    userId: string,
    connectionId: string,
    query: string,
    /** The run's abort: a stopped turn must stop its statement, not leave it running. */
    signal?: AbortSignal,
  ): Promise<{
    columns: Array<{ name: string }>
    rows: unknown[][]
    rowsAffected?: number
    durationMs: number
    /** The statement returned more than `RESULT_ROW_CAP` rows; `rows` is the first of them. */
    truncated?: boolean
  } | null>
}

export interface DbQueryToolOptions {
  userId: string
  port: DbQueryPort
}

interface DbQueryDetails {
  connection: string
  dialect: string
  durationMs: number
  rowsAffected?: number
  columns?: string[]
  rowCount?: number
  /** `rowCount` is the row cap, not the size of the result. */
  truncated?: boolean
}

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      `The statement to run in the selected engine's native language. Supported forms: ${DATABASE_DRIVERS.map(
        (driver) => `${driver.label}: ${driver.queryExample}`,
      ).join('; ')}.`,
    ),
  connection_id: z
    .string()
    .optional()
    .describe('Which connection to run against. Omit when exactly one database is connected.'),
})

const MAX_ROWS = 50
const MAX_CELL = 200
/** Binary columns (Postgres bytea / MySQL BLOB) come back as a Buffer, i.e. a Uint8Array. */
const HEX_CAP = 32

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  // Binary → a compact, BOUNDED hex string (`\xdeadbeef`), never the giant
  // `{"type":"Buffer","data":[…]}` that JSON.stringify would emit (thousands of noise tokens).
  if (value instanceof Uint8Array) {
    let hex = ''
    for (let i = 0; i < Math.min(value.length, HEX_CAP); i++)
      hex += value[i]!.toString(16).padStart(2, '0')
    return value.length > HEX_CAP ? `\\x${hex}… (${value.length} bytes)` : `\\x${hex}`
  }
  const s =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as number | boolean | bigint | symbol)
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s
}

/** Render a compact fixed-width text table (capped rows/columns) for the model. */
export function renderDbRows(columns: Array<{ name: string }>, rows: unknown[][]): string {
  if (columns.length === 0) return ''
  const shown = rows.slice(0, MAX_ROWS)
  const headers = columns.map((c) => c.name)
  const widths = headers.map((h, i) =>
    Math.min(40, Math.max(h.length, ...shown.map((r) => cellText(r[i]).length), 1)),
  )
  const pad = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w))
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join(' | ')
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-')
  const body = shown.map((r) => line(headers.map((_, i) => cellText(r[i]))))
  return [line(headers), sep, ...body].join('\n')
}

/** Run a query/command against a user's connected database. Text-first (token-cheap) results.
 *  Speaks SQL to SQL engines and each non-SQL engine's own command language (the service's
 *  driver parses the command); the compact text-table renderer handles either uniformly. */
export function createDbQueryTool(options: DbQueryToolOptions) {
  return defineAgentTool({
    name: 'db_query',
    activeVerb: 'Querying database',
    description:
      "Run a query against a database the user connected in the Database workbench — SQL for SQLite/Postgres/MySQL/SQL Server, or the engine's native command language for Redis / MongoDB / Elasticsearch. Returns a compact text table for row results (capped at 50 rows) or an affected-row count. For wide or large tables, select the specific columns you need and add a LIMIT — a `SELECT *` dump is token-expensive. Runs against the user's real database — treat writes/DDL with care.",
    inputSchema,
    executionMode: 'sequential',
    // Honest about writing (its description already said "treat writes/DDL with care"),
    // which is what puts a DDL/DML call behind the ask-mode confirmation.
    mutates: true,
    // This tool can mutate a configured remote database, never a filesystem path.
    // Declaring the empty target set here keeps that decision mini-app-owned instead
    // of requiring a host-side exemption keyed by this concrete tool name.
    permissionPaths: () => [],
    /**
     * …and honest that a SELECT is not a write, which is what keeps reads free of the
     * confirmation. Without the pair, declaring `mutates` would gate every call — reads
     * included — behind it.
     *
     * This runs on the permission path, pure and synchronous, so it cannot resolve
     * `connection_id` to an engine: `classifyQueryText` calls a query a read only when it is
     * one on WHICHEVER engine runs it (a SELECT calling only side-effect-free built-ins, or a
     * Redis/Mongo/Elasticsearch read). Anything it cannot prove is an irreversible external
     * write.
     */
    classify: (input) => classifyQueryText((input as { query?: unknown } | null)?.query),
    async execute(_toolCallId, input, signal) {
      const resolution = resolveAgentDatabaseConnection(
        await options.port.listConnections(options.userId),
        input.connection_id,
      )
      if (!resolution.ok) return { content: resolution.error, isError: true }
      const target = resolution.target

      let result
      try {
        result = await options.port.runQuery(options.userId, target.id, input.query, signal)
      } catch (err) {
        return {
          content: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
      if (!result) return { content: 'Connection not found or disconnected.', isError: true }

      const ms = Math.round(result.durationMs)
      // Surface the dialect so the agent writes dialect-correct follow-ups (SQL LIMIT vs TOP,
      // or the right non-SQL command shape) without a separate discovery call.
      const manifest = isDatabaseDialect(target.dialect)
        ? DATABASE_DRIVERS.find((driver) => driver.id === target.dialect)
        : undefined
      // Say it is read-only too, for the same reason: the tool KNEW this and only ever told
      // the agent by rejecting a write with `readonly_blocked`, so a plan against a
      // production connection burned a round trip discovering it. Cheap, and it stops the
      // agent proposing writes it cannot make.
      const guard = target.readonly ? ' · read-only' : ''
      const on = `"${target.name}" [${target.dialect}]${manifest ? ` · ${manifest.queryLanguage}` : ''}${guard}`
      if (result.columns.length === 0) {
        const details: DbQueryDetails = {
          connection: target.name,
          dialect: target.dialect,
          rowsAffected: result.rowsAffected ?? 0,
          durationMs: ms,
        }
        return {
          content: `OK — ${result.rowsAffected ?? 0} row(s) affected on ${on} in ${ms} ms.`,
          details,
        }
      }

      const table = renderDbRows(result.columns, result.rows)
      const more =
        result.rows.length > MAX_ROWS
          ? `\n… ${result.rows.length - MAX_ROWS} more rows (showing ${MAX_ROWS}).`
          : ''
      const details: DbQueryDetails = {
        connection: target.name,
        dialect: target.dialect,
        columns: result.columns.map((c) => c.name),
        rowCount: result.rows.length,
        durationMs: ms,
        ...(result.truncated ? { truncated: true } : {}),
      }
      // A capped result must not read as the whole one: "10000 row(s)" would be a count the
      // agent then reasons from. It is told the result is LARGER, and how to get what it needs.
      const count = result.truncated
        ? `The first ${result.rows.length} rows (the result has more; add a LIMIT, a WHERE or an aggregate to see the rest)`
        : `${result.rows.length} row(s)`
      return {
        content: `${count} from ${on} in ${ms} ms:\n\n${table}${more}`,
        details,
      }
    },
  })
}
