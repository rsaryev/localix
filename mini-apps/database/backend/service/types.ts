/** The database service's public method surface (facade contract). */
import type {
  BatchResponse,
  ConnectRequest,
  DbConnectionConfig,
  DbConnectionInfo,
  QueryResponse,
  BrowseResponse,
  ColumnCatalogResponse,
  SchemasResponse,
  TableSchemaResponse,
  ValidateResponse,
} from '../contracts'
import type { BatchStatement, DbBrowseRequest } from '../drivers/port'
import type { QueryOptions } from './run-query'

export interface DatabaseService {
  connect(userId: string, req: ConnectRequest): Promise<DbConnectionInfo>
  /** Validate a config WITHOUT saving it (the connect form's "Test connection"): build a
   *  driver, probe it, close it. Resolves on success — with the SSH bastion's host key when
   *  the config tunnels, so the form can show what a save would pin; throws a typed error on
   *  failure (including a host key that does not match the config's pin). */
  testConnection(
    userId: string,
    config: DbConnectionConfig,
  ): Promise<{ hostKeyFingerprint?: string }>
  /** Re-establish a persisted connection. Returns null if it isn't saved. */
  reconnect(userId: string, id: string): Promise<DbConnectionInfo | null>
  /** Rename a saved connection's display label. Returns null if it isn't saved. */
  rename(userId: string, id: string, name: string): Promise<DbConnectionInfo | null>
  /** The stored config of a saved connection (tokens as-stored), for the edit form.
   *  Returns null if it isn't saved. */
  getConfig(
    userId: string,
    id: string,
  ): Promise<{ name: string; config: DbConnectionConfig } | null>
  /** Change a saved connection's config (and optionally its name), keeping its id (and
   *  thus its console draft/history/open tab). Validates the new config exactly like
   *  `connect` (throws the same typed error on unreachable/bad credentials), then swaps
   *  the live driver so subsequent queries use it. Returns null if it isn't saved. */
  updateConfig(
    userId: string,
    id: string,
    input: { name?: string; config: DbConnectionConfig },
  ): Promise<DbConnectionInfo | null>
  /** Close the live driver but keep the saved config. */
  disconnect(userId: string, id: string): Promise<boolean>
  /** Close the live driver AND forget the saved config. */
  remove(userId: string, id: string): Promise<boolean>
  list(userId: string): Promise<DbConnectionInfo[]>
  query(
    userId: string,
    id: string,
    sql: string,
    params?: unknown[],
    opts?: QueryOptions,
  ): Promise<QueryResponse | null>
  /** Compile (never execute) each top-level statement of `sql` with the engine itself.
   *  Returns null if the connection isn't live; `supported: false` for an engine without a
   *  compile-only check. Never throws for an engine or SQL failure — that is the verdict. */
  validate(
    userId: string,
    id: string,
    sql: string,
    signal?: AbortSignal,
  ): Promise<ValidateResponse | null>
  /** Read one bounded page from a database object through the driver's structured port. */
  browse(
    userId: string,
    id: string,
    request: DbBrowseRequest,
    opts?: QueryOptions,
  ): Promise<BrowseResponse | null>
  /** Run several statements as ONE atomic transaction (row-editing "Commit"). Returns null
   *  if the connection isn't live; throws `readonly_blocked` if any statement isn't a pure
   *  read on a read-only connection, `tx_unsupported` if the driver cannot make the batch
   *  atomic, or a mapped driver error (rolled back) on failure. */
  executeBatch(
    userId: string,
    id: string,
    statements: BatchStatement[],
  ): Promise<BatchResponse | null>
  /** Open a MANUAL transaction on a connection (subsequent `query` calls run inside it
   *  until commit/rollback). No-op if one is already open. Returns null if not live;
   *  throws `tx_unsupported` on an engine without manual transactions. */
  beginTx(userId: string, id: string): Promise<DbConnectionInfo | null>
  /** COMMIT the open manual transaction (no-op if none). Returns null if not live. */
  commitTx(userId: string, id: string): Promise<DbConnectionInfo | null>
  /** ROLLBACK the open manual transaction (no-op if none). Returns null if not live. */
  rollbackTx(userId: string, id: string): Promise<DbConnectionInfo | null>
  /** Abort every in-flight query on a connection. Returns how many were cancelled (0 if none/not found). */
  cancel(userId: string, id: string): number
  /** Health-check a live connection with a lightweight probe. A dead driver is closed
   *  and dropped (so it reads as disconnected). Returns false if not live or unhealthy. */
  ping(userId: string, id: string): Promise<boolean>
  schemas(userId: string, id: string): Promise<SchemasResponse | null>
  columnCatalog(userId: string, id: string): Promise<ColumnCatalogResponse | null>
  tableSchema(
    userId: string,
    id: string,
    schema: string | undefined,
    table: string,
  ): Promise<TableSchemaResponse | null>
  /** Sanitized successful query shapes for server-resolved prediction context. */
  recentQueries(userId: string, id: string, limit?: number): Promise<string[]>
  closeAll(): Promise<void>
}
