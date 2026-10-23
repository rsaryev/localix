/**
 * The MODEL-FACING CONTRACT of `database_client` — the mini app's ONE agent tool.
 *
 * It was three (`db_schema`, `db_browse`, `db_query`), and managing connections would have made a
 * fourth: four names whose descriptions each had to explain the other three ("use db_browse after
 * db_schema, db_query only when…"). The subject is the same throughout — one user's databases —
 * so the axis is the VERB, the way `api_client` fronts requests and environments:
 *
 *     action: connections | schema | browse | query | connect | test | reconnect | disconnect | remove
 *
 * One flat object, per-action fields as optional siblings, and every `.describe()` names the
 * action that needs the field. The bodies behind the verbs stay separate modules
 * (`db-schema.ts`, `db-browse.ts`, `db-query.ts`, `db-connections.ts`); only the contract merged.
 */
import type { CallClass } from '@localixai/agent/agents'
import { z } from 'zod'
import type { DatabaseChange } from '../shared/database-changes'
import { DATABASE_DRIVERS } from '../shared/driver-catalog'
import { isSchemaChangingStatement } from '../shared/schema-change'
import { fileUrlPath } from './file-url'
import { isReadOnlyForUnknownEngine } from './read-only'

export const DATABASE_ACTIONS = [
  'connections',
  'schema',
  'browse',
  'query',
  'connect',
  'test',
  'reconnect',
  'disconnect',
  'remove',
] as const

const ENGINES = DATABASE_DRIVERS.map((driver) => driver.id) as [string, ...string[]]

export const databaseToolSchema = z.object({
  action: z
    .enum(DATABASE_ACTIONS)
    .describe(
      'connections = list saved connections (connected or not); schema = tables of a connection, or one table in detail; ' +
        'browse = sample rows of a table/collection/index/key safely; query = run a statement in the engine language; ' +
        'connect = add (or reopen) a connection; test = check a connection config without saving it; ' +
        'reconnect / disconnect / remove = manage a saved connection by connection_id.',
    ),
  connection_id: z
    .string()
    .optional()
    .describe(
      'schema/browse/query: which connection (omit when exactly one is connected). reconnect/disconnect/remove: required.',
    ),
  table: z
    .string()
    .optional()
    .describe(
      'schema: describe this table/collection (columns, keys, indexes, triggers). browse: required — the object to sample.',
    ),
  schema: z
    .string()
    .optional()
    .describe('schema/browse: schema or namespace that qualifies `table`.'),
  query: z
    .string()
    .optional()
    .describe(
      `query: required — the statement in the engine's own language. ${DATABASE_DRIVERS.map(
        (driver) => `${driver.label}: ${driver.queryExample}`,
      ).join('; ')}.`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('browse: rows to return (1–50, default 20).'),
  offset: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .optional()
    .describe('browse: zero-based row offset.'),
  sort_column: z.string().min(1).optional().describe('browse: column/field to sort by.'),
  sort_direction: z.enum(['asc', 'desc']).optional().describe('browse: sort direction.'),
  engine: z
    .enum(ENGINES)
    .optional()
    .describe(
      'connect/test: the engine. Inferred from the url scheme (postgres://, mysql://, mongodb://…) or a .db/.sqlite file; required for http(s):// (clickhouse or elasticsearch) and ambiguous files.',
    ),
  url: z
    .string()
    .optional()
    .describe(
      'connect/test: connection URL, e.g. "postgres://app@db.internal:5432/shop". Or use host fields.',
    ),
  file: z.string().optional().describe('connect/test: SQLite file path, or ":memory:".'),
  host: z.string().optional().describe('connect/test: host, instead of a url.'),
  port: z.number().int().min(1).max(65535).optional().describe('connect/test: port (with host).'),
  user: z.string().optional().describe('connect/test: user name (with host).'),
  password: z
    .string()
    .optional()
    .describe(
      'connect/test: password (with host). Prefer a vault reference "${secret:KEY}" over a literal.',
    ),
  database: z.string().optional().describe('connect/test: database name (with host).'),
  name: z.string().min(1).max(200).optional().describe('connect: display name for the connection.'),
  readonly: z
    .boolean()
    .optional()
    .describe('connect: block writes on this connection (recommended for production data).'),
})
export type DatabaseToolInput = z.infer<typeof databaseToolSchema>

/**
 * Read or write, per call — the pair that keeps inspection free of the ask-mode confirmation
 * while a write waits for it, and what a read-only plan session denies on. So it must be
 * truthful BOTH ways: a write called "read" runs unconfirmed in a session promised to write
 * nothing, and a read called "write" is refused there.
 *
 * `test` opens and closes a connection and saves nothing, so it is a read. `query` runs on the
 * permission path, before `connection_id` can be resolved to an engine, so it is judged by
 * {@link isReadOnlyForUnknownEngine}: a read only when proven a read on whichever engine runs it
 * — a SQL SELECT that calls only side-effect-free built-ins, or a Redis/Mongo/Elasticsearch
 * read in that engine's own syntax.
 */
export function classifyDatabaseCall(input: unknown): 'read' | 'write' {
  const call = (input ?? {}) as { action?: unknown; query?: unknown }
  switch (call.action) {
    case 'connections':
    case 'schema':
    case 'browse':
    case 'test':
      return 'read'
    case 'query':
      return typeof call.query === 'string' && isReadOnlyForUnknownEngine(call.query)
        ? 'read'
        : 'write'
    default:
      return 'write'
  }
}

const READ_CALL: CallClass = { effect: 'read' }
const HOST_CALL: CallClass = { effect: 'host' }
/**
 * A write query reaches the user's real database — past the machine for a server engine, and
 * past anything a session can roll back for every engine — so it is `external`; and a
 * `DELETE`/`DROP` cannot be taken back, while the classifier cannot tell those from an `INSERT`
 * without the engine. Every non-read query is therefore irreversible: the conservative answer.
 */
const WRITE_QUERY_CALL: CallClass = { effect: 'external', irreversible: true }

/** One query's class, from the same read/write line {@link classifyDatabaseCall} draws. */
export function classifyQueryText(query: unknown): CallClass {
  return typeof query === 'string' && isReadOnlyForUnknownEngine(query)
    ? READ_CALL
    : WRITE_QUERY_CALL
}

/**
 * The permission class of one `database_client` call: the read/write verdict above, widened to
 * WHERE a write lands. A write query is {@link classifyQueryText}'s. The saved-connection list
 * is the agent's own state beyond this conversation, so `connect`/`reconnect`/`disconnect` are
 * `host`, and `remove` forgets a connection (and its stored credential) for good. An action
 * this switch does not know is `external`, never a read.
 */
export function classifyDatabaseCallClass(input: unknown): CallClass {
  const call = (input ?? {}) as { action?: unknown; query?: unknown }
  switch (call.action) {
    case 'query':
      return classifyQueryText(call.query)
    case 'connect':
    case 'reconnect':
    case 'disconnect':
      return HOST_CALL
    case 'remove':
      return { effect: 'host', irreversible: true }
    default:
      return classifyDatabaseCall(call) === 'read' ? READ_CALL : { effect: 'external' }
  }
}

/**
 * The local file a call can create or write, for the permission engine's path rules.
 *
 * The defect: the tool declared NO paths, so `connect` with `file: "/etc/app.db"` was
 * invisible to the outside-workspace rule and to every user path rule — yet the SQLite
 * driver opens a writable connection with `create`, making the file if it is missing, and
 * every later write query lands in it. `test` opens the file the same way. A server engine
 * reached by url or host touches no local path. `:memory:` is no file.
 */
export function databaseCallPaths(input: unknown): string[] {
  const call = (input ?? {}) as { action?: unknown; file?: unknown; url?: unknown }
  if (call.action !== 'connect' && call.action !== 'test') return []
  const file =
    typeof call.file === 'string' && call.file
      ? call.file
      : typeof call.url === 'string'
        ? (fileUrlPath(call.url) ?? '')
        : ''
  return file && file !== ':memory:' ? [file] : []
}

/**
 * What a SUCCESSFUL call changed, for the workbench to re-read — or null for a read. The same
 * read/write line as {@link classifyDatabaseCall}; a write `query` is a schema change when it is
 * DDL (the console's own rule, `shared/schema-change.ts`) and a data change otherwise.
 */
export function changeOfCall(input: DatabaseToolInput): DatabaseChange | null {
  if (classifyDatabaseCall(input) === 'read') return null
  if (input.action !== 'query') return { type: 'connections' }
  const type = isSchemaChangingStatement(input.query ?? '') ? 'schema' : 'data'
  return input.connection_id ? { type, connectionId: input.connection_id } : { type }
}

/** The field an action cannot run without, said as what to do, or null. */
export function databaseCallProblem(input: DatabaseToolInput): string | null {
  const needs = (field: keyof DatabaseToolInput, what: string) =>
    input[field] === undefined || input[field] === ''
      ? `action="${input.action}" needs ${what}.`
      : null
  switch (input.action) {
    case 'browse':
      return needs('table', 'table (the object to sample)')
    case 'query':
      return needs('query', 'query (the statement to run)')
    case 'reconnect':
    case 'disconnect':
    case 'remove':
      return needs('connection_id', 'connection_id (see action="connections")')
    case 'connect':
    case 'test':
      return input.url || input.file || input.host
        ? null
        : `action="${input.action}" needs a url, a file (SQLite), or a host.`
    case 'connections':
    case 'schema':
      return null
  }
}
