// Request/response contracts for the database mini app's backend routes. The
// connection-config zod schemas (ssl / ssh / per-dialect union) live in
// ./contracts/connection-config; this facade re-exports the full public surface.
import { z } from 'zod'
import type {
  DbColumnCatalog,
  DbResultSet,
  DbSchemas,
  DbTableSchema,
  DriverFlags,
} from './drivers/port'
import type { DbErrorCode, DbStatementFailure } from './errors'
import { dbConnectionConfigSchema, type DbConnectionConfig } from './contracts/connection-config'
import type { ConnectionColor } from './colors'

// The connection color palette lives in the zod-free `colors.ts` leaf (so the UI can
// value-import it without pulling this schema module); re-exported here for backend callers.

export type { ConnectionColor } from './colors'

export {
  dbConnectionConfigSchema,
  sshTunnelConfigSchema,
  isFileConnectionConfig,
  isNetworkConnectionConfig,
} from './contracts/connection-config'
export type {
  DbConnectionConfig,
  DbSslConfig,
  SshTunnelConfig,
} from './contracts/connection-config'

/**
 * Identify an on-disk database file before opening it as a connection (see
 * `probe-database-file.ts`). The path must be absolute for the same reason a deep-link
 * path must: a relative one would resolve against whatever cwd the server happens to
 * have, so the file the user double-clicked and the file we probe could differ.
 */
export const probeFileRequestSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (p) => p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p),
      'A database file path must be absolute.',
    ),
})

export const connectRequestSchema = z.object({
  /** Optional display name; defaults to a dialect-derived label. */
  name: z.string().min(1).max(200).optional(),
  config: dbConnectionConfigSchema,
})
export type ConnectRequest = z.infer<typeof connectRequestSchema>

/** Rename a saved connection (display label only; config untouched). */
export const renameRequestSchema = z.object({
  name: z.string().min(1).max(200),
})

/** Edit a saved connection's config (and optionally its display name) in place, keeping
 *  its id. Validated like `connect` before it is saved. The dialect can change through
 *  the schema, but the UI keeps it fixed (a different engine is a different connection). */
export const updateConfigRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: dbConnectionConfigSchema,
})
export type UpdateConfigRequest = z.infer<typeof updateConfigRequestSchema>

/** A saved connection's stored config, for pre-filling the edit form. `${secret:KEY}`
 *  tokens are returned AS-STORED (never resolved) — a vaulted credential stays a token. */
export interface SavedConnectionConfigResponse {
  name: string
  config: DbConnectionConfig
}

export const queryRequestSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
  /** Per-query wall-clock cap in ms. Omit for the server default (30s); `0` disables it. */
  timeoutMs: z.number().int().min(0).max(3_600_000).optional(),
})

/** Structured, read-only page request used by Database Workspace's data browser. */
export const browseRequestSchema = z.object({
  table: z.string().min(1).max(500),
  schema: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  sort: z
    .object({
      column: z.string().min(1).max(500),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
})
export type BrowseRequest = z.infer<typeof browseRequestSchema>

/** One parameterized statement in an atomic row-editing batch. Values stay out of the SQL
 * text and travel through each driver's native binding path. */
export const batchStatementSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
})

/** An atomic batch of statements (row-editing "Commit"): applied in one transaction. */
export const batchRequestSchema = z.object({
  statements: z.array(batchStatementSchema).min(1).max(1000),
})
export type BatchRequest = z.infer<typeof batchRequestSchema>

/** A saved connection descriptor returned to the client (never carries secrets).
 *  `connected` is false for a persisted connection not currently established;
 *  `flags` is present only once a live driver exists. */
export interface DbConnectionInfo {
  id: string
  name: string
  dialect: DbConnectionConfig['dialect']
  connected: boolean
  /** Config-derived write guard-rail (safe to surface; not a secret). When true, the
   *  service rejects write/DDL statements — the UI badges + gates row editing on it. */
  readonly: boolean
  /**
   * HOW the `readonly` promise is kept, for a CONNECTED connection.
   *
   * `true` — the engine itself is enforcing it (a session-scoped read-only transaction, or
   * SQLite's `query_only`), so a write fails at the server no matter how it is phrased.
   * `false` — only the statement classifier is guarding it, which cannot see a write
   * wearing a SELECT (`SELECT nextval(…)`, a volatile UDF, `dblink_exec`). Its own header
   * says it is not a security boundary.
   *
   * `undefined` while disconnected: there is no session to have asked yet. Six engines have
   * no server-side switch at all — see `read-only/server-guard.ts` for which and why — so a
   * `false` here is often the engine's limit rather than a failure.
   *
   * Surfaced because "read-only" without this reads as one guarantee when it is two: a user
   * marking a PRODUCTION connection read-only deserves to know which one they got.
   */
  serverReadOnly?: boolean
  /** Optional color tag for at-a-glance identification (not a secret; metadata only). */
  color?: ConnectionColor
  /** True when the connection routes through an SSH tunnel (config presence only; no creds). */
  hasSsh?: boolean
  flags?: DriverFlags
  /** True while a MANUAL transaction ("Tx: Manual") is open on the live driver —
   *  the console shows the Commit/Rollback controls + an "open" indicator. */
  txOpen?: boolean
  createdAt: number
}

/** How many statements of a multi-statement text ran. Present only when the text held more
 *  than one executable statement; `result` is then the LAST row-returning statement's result,
 *  or — when none returned rows — the summed `rowsAffected` of all of them. */
export interface QueryStatementCount {
  total: number
  executed: number
}

export interface QueryResponse {
  result: DbResultSet
  statements?: QueryStatementCount
}

/** Ask the engine to compile (never execute) each top-level statement of `sql`. */
export const validateRequestSchema = z.object({
  sql: z.string().min(1).max(200_000),
})

/** One statement's verdict. Offsets are 0-based UTF-16 offsets into the WHOLE submitted text. */
export interface ValidateStatementResult {
  statementStart: number
  ok: boolean
  message?: string
  /** Where the engine located the problem, when it reports a position. */
  offset?: number
  /** Engine error code (SQLSTATE, errno, ClickHouse code …) when one was reported. */
  code?: string
  /** `ok` without a verdict: the engine was busy, the statement kind cannot be compiled
   *  side-effect free, or it depends on an earlier statement of the same text. */
  skipped?: 'busy' | 'unsupported' | 'depends-on-earlier' | 'limit'
}

export interface ValidateResponse {
  /** False when the engine offers no compile-only check (the UI keeps its own checks). */
  supported: boolean
  results: ValidateStatementResult[]
}

export type BrowseResponse = QueryResponse

/** Result of an atomic batch (one entry per statement, in order). */
export interface BatchResponse {
  results: DbResultSet[]
}

/** Result of cancelling the in-flight queries on a connection. */
export interface CancelResponse {
  /** How many in-flight queries were aborted. */
  cancelled: number
}

/** Result of a connection health check. `alive: false` means the live driver was found
 *  dead and dropped (the connection is now disconnected). */
export interface PingResponse {
  alive: boolean
}

/** Error payload for a failed query/connect — `{ code, message }` the UI renders cleanly. */
export interface DbErrorResponse {
  error: string
  code: DbErrorCode
  /** Raw engine text, when it differs from the friendly message. */
  detail?: string
  /** For a multi-statement run: which statement failed and how many ran before it. */
  statement?: DbStatementFailure
}

export interface SchemasResponse {
  schemas: DbSchemas
}

/** `catalog: null` — this engine has no one-query column catalog; read tables one by one. */
export interface ColumnCatalogResponse {
  catalog: DbColumnCatalog | null
}

export interface TableSchemaResponse {
  table: DbTableSchema
}
