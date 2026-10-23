// REST client for the SQL console / schema browser backend (`/rpc/database`).
// The backend returns query/introspection errors as a flat `{ error: '<engine msg>' }`
// with a 4xx — we surface that message verbatim so the console can render it.
import {
  miniAppApiFetch,
  postMiniAppJson as postJson,
  problemRequestOf,
} from '@localixai/mini-app-sdk/ui/transport'
import type { ProblemRequest } from '@localixai/mini-app-sdk/ui/problems'
import type {
  BatchRequest,
  BatchResponse,
  BrowseRequest,
  BrowseResponse,
  CancelResponse,
  ConnectRequest,
  DbConnectionInfo,
  DbErrorCode,
  DbSchemas,
  DbColumnCatalog,
  DbTableSchema,
  PingResponse,
  QueryResponse,
  SavedConnectionConfigResponse,
  UpdateConfigRequest,
  ValidateResponse,
} from '../dbClient'
import type { DatabaseFileProbe } from '../../shared/database-file'
import { DATABASE_CONNECTIONS } from '../model/topics'

/** A failed `/rpc/database` call, carrying the backend's typed `{ code, detail }`
 *  so the console can render a friendly, code-aware message (e.g. a soft "cancelled"). */
export class DbApiError extends Error {
  readonly code?: DbErrorCode
  readonly detail?: string
  /** The call that failed — its Event Center row traces exactly this request. */
  readonly request?: ProblemRequest
  constructor(message: string, code?: DbErrorCode, detail?: string, request?: ProblemRequest) {
    super(message)
    this.name = 'DbApiError'
    this.code = code
    this.detail = detail
    this.request = request
  }
}

async function readOr<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: DbErrorCode; detail?: string })
    | null
  if (!res.ok || (json && typeof json.error === 'string')) {
    throw new DbApiError(
      json?.error ?? `Request failed (${res.status})`,
      json?.code,
      json?.detail,
      problemRequestOf(res),
    )
  }
  return json as T
}

export const databaseApi = {
  async list(): Promise<DbConnectionInfo[]> {
    const res = await miniAppApiFetch('/rpc/database', { method: 'GET' })
    return (await readOr<{ connections: DbConnectionInfo[] }>(res)).connections
  },

  /** Validate a config without saving it (connect form's "Test connection"). Throws on failure.
   *  Answers with the SSH bastion's host key when the config tunnels — what a save would pin. */
  async test(config: ConnectRequest['config']): Promise<{ hostKeyFingerprint?: string }> {
    const res = await postJson(`/rpc/database/test`, { config })
    const { hostKeyFingerprint } = await readOr<{ ok: true; hostKeyFingerprint?: string }>(res)
    return hostKeyFingerprint ? { hostKeyFingerprint } : {}
  },
  async connect(req: ConnectRequest): Promise<DbConnectionInfo> {
    const res = await postJson('/rpc/database/connect', req)
    const connection = (await readOr<{ connection: DbConnectionInfo }>(res)).connection
    DATABASE_CONNECTIONS.invalidate()
    return connection
  },
  /**
   * Identify an on-disk database file before connecting to it. `openable: false` is a
   * normal 200 answer (the file is simply not a database), so it is RETURNED, not thrown —
   * only a transport/validation failure raises.
   */
  async probeFile(path: string): Promise<DatabaseFileProbe> {
    const res = await postJson('/rpc/database/probe-file', { path })
    return await readOr<DatabaseFileProbe>(res)
  },

  async disconnect(id: string): Promise<void> {
    await readOr(await postJson(`/rpc/database/${id}/disconnect`, {}))
    DATABASE_CONNECTIONS.invalidate()
  },

  async reconnect(id: string): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/reconnect`, {})
    const connection = (await readOr<{ connection: DbConnectionInfo }>(res)).connection
    DATABASE_CONNECTIONS.invalidate()
    return connection
  },

  async rename(id: string, name: string): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/rename`, { name })
    const connection = (await readOr<{ connection: DbConnectionInfo }>(res)).connection
    DATABASE_CONNECTIONS.invalidate()
    return connection
  },

  /** Fetch a saved connection's stored config to pre-fill the edit form (tokens as-stored). */
  async getConfig(id: string): Promise<SavedConnectionConfigResponse> {
    const res = await miniAppApiFetch(`/rpc/database/${id}/config`, { method: 'GET' })
    return await readOr<SavedConnectionConfigResponse>(res)
  },

  /** Edit a saved connection's config (+ name) in place, keeping its id. Validated
   *  server-side like connect — a bad URL rejects with the engine message. */
  async updateConfig(id: string, req: UpdateConfigRequest): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/config`, req)
    const connection = (await readOr<{ connection: DbConnectionInfo }>(res)).connection
    DATABASE_CONNECTIONS.invalidate()
    return connection
  },

  async remove(id: string): Promise<void> {
    await readOr(await postJson(`/rpc/database/${id}/remove`, {}))
    DATABASE_CONNECTIONS.invalidate()
  },

  async query(id: string, sql: string, params?: unknown[]): Promise<QueryResponse['result']> {
    const res = await postJson(`/rpc/database/${id}/query`, { sql, params })
    return (await readOr<QueryResponse>(res)).result
  },

  /** Ask the engine to COMPILE each statement of `sql` without running any of it. */
  async validate(id: string, sql: string, signal?: AbortSignal): Promise<ValidateResponse> {
    const res = await miniAppApiFetch(`/rpc/database/${id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
      signal,
    })
    return await readOr<ValidateResponse>(res)
  },

  async browse(id: string, request: BrowseRequest): Promise<BrowseResponse['result']> {
    const res = await postJson(`/rpc/database/${id}/browse`, request)
    return (await readOr<BrowseResponse>(res)).result
  },

  /** Apply several statements as ONE atomic transaction (grid row-editing "Commit"). */
  async batch(
    id: string,
    statements: BatchRequest['statements'],
  ): Promise<BatchResponse['results']> {
    const res = await postJson(`/rpc/database/${id}/batch`, { statements })
    return (await readOr<BatchResponse>(res)).results
  },

  /** Open a MANUAL transaction on a connection ("Tx: Manual"). Idempotent. */
  async beginTx(id: string): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/tx/begin`, {})
    return (await readOr<{ connection: DbConnectionInfo }>(res)).connection
  },

  /** COMMIT the open manual transaction (no-op if none open). */
  async commitTx(id: string): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/tx/commit`, {})
    return (await readOr<{ connection: DbConnectionInfo }>(res)).connection
  },

  /** ROLLBACK the open manual transaction (no-op if none open). */
  async rollbackTx(id: string): Promise<DbConnectionInfo> {
    const res = await postJson(`/rpc/database/${id}/tx/rollback`, {})
    return (await readOr<{ connection: DbConnectionInfo }>(res)).connection
  },

  /** Abort every in-flight query on a connection. Returns how many were cancelled. */
  async cancel(id: string): Promise<number> {
    const res = await postJson(`/rpc/database/${id}/cancel`, {})
    return (await readOr<CancelResponse>(res)).cancelled
  },

  /** Health-check a connection. Returns false if it's dead (the backend drops it). */
  async ping(id: string): Promise<boolean> {
    const res = await postJson(`/rpc/database/${id}/ping`, {})
    return (await readOr<PingResponse>(res)).alive
  },

  async schemas(id: string): Promise<DbSchemas> {
    const res = await miniAppApiFetch(`/rpc/database/${id}/schemas`, { method: 'GET' })
    return (await readOr<{ schemas: DbSchemas }>(res)).schemas
  },

  /** One-query column catalog, or null when the engine reads columns table by table. */
  async columnCatalog(id: string): Promise<DbColumnCatalog | null> {
    const res = await miniAppApiFetch(`/rpc/database/${id}/columns`, { method: 'GET' })
    return (await readOr<{ catalog: DbColumnCatalog | null }>(res)).catalog
  },

  async tableSchema(id: string, table: string, schema?: string): Promise<DbTableSchema> {
    const qs = schema ? `?schema=${encodeURIComponent(schema)}` : ''
    const res = await miniAppApiFetch(
      `/rpc/database/${id}/table/${encodeURIComponent(table)}${qs}`,
      {
        method: 'GET',
      },
    )
    return (await readOr<{ table: DbTableSchema }>(res)).table
  },
}
