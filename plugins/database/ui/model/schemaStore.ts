import type { DbSchemas } from '../dbClient'
import { databaseApi } from '../api/databaseApi'
import { catalogRecord, schemaTableKey } from './schemaKey'
import {
  clearTableError,
  commit,
  detailOf,
  EMPTY,
  entries,
  errorMessage,
  getEntry,
  resetEntry,
  scheduleCommit,
  stageTable,
  type Entry,
  type SchemaSnapshot,
} from './schemaEntry'

/**
 * Process-wide schema cache keyed by connectionId, so every consumer of a
 * connection's schema (the sidebar tree, an open SQL console's autocomplete, a
 * `.sql` file editor) shares ONE fetch + one lazy per-table column cache instead
 * of each re-introspecting the same database. A reload from any surface refreshes
 * all of them. Consumed via {@link useSchema} through `useSyncExternalStore`.
 */

const PREFETCH_CAP = 150

/**
 * Max per-table column fetches kept in flight for BOTH background loaders — the eager
 * {@link prefetch} and the search-driven {@link ensureColumns} top-up — so opening or
 * filtering a large connection can't fire hundreds of requests at once.
 *
 * The prefetch used to bypass this: it called {@link loadTable} in a bare loop, putting all
 * {@link PREFETCH_CAP} introspections in flight the instant the tree arrived. Two things make
 * that expensive rather than merely eager. The PostgreSQL driver's pool is `max: 1`
 * (`buildPostgresOptions`), so those requests serialize at the driver anyway — the
 * parallelism buys nothing. And the browser allows ~6 requests per host, so every OTHER call
 * the app makes queues behind the backlog: the console's own query waits for a prefetch the
 * user never asked for. One shared budget keeps the work identical and the wait bounded.
 *
 * Three, not six: six was the whole per-host allowance, so a full background lane still left an
 * interactive read (a node expanded, the console's own query) queued behind it. Half the
 * allowance keeps room for those while the driver, serial anyway, stays fed.
 *
 * Interactive reads are deliberately NOT queued — see {@link loadTable}.
 */
export const COLUMN_LOAD_CONCURRENCY = 3

function fetchSchemas(connectionId: string, e: Entry): void {
  e.fetchStarted = true
  const revision = e.schemaRevision
  databaseApi
    .schemas(connectionId)
    .then((s) => {
      if (e.schemaRevision !== revision) return
      e.schemas = s
      e.error = null
      e.errorDetail = null
      e.loading = false
      commit(e)
      loadColumnCatalog(connectionId, e, s, revision)
    })
    .catch((err) => {
      if (e.schemaRevision !== revision) return
      e.error = err instanceof Error ? err.message : 'Could not load the schema.'
      e.errorDetail = detailOf(err)
      e.loading = false
      commit(e)
    })
}

/**
 * Read every table's columns in one request when the engine can, and fall back to the per-table
 * {@link prefetch} when it cannot (or the catalog read fails). Before this, the prefetch was the
 * only path: up to {@link PREFETCH_CAP} full structure reads, ~20 catalog queries each on Postgres.
 */
function loadColumnCatalog(
  connectionId: string,
  e: Entry,
  schemas: DbSchemas,
  revision: number,
): void {
  databaseApi
    .columnCatalog(connectionId)
    .then((catalog) => {
      if (e.schemaRevision !== revision) return
      if (!catalog) return prefetch(connectionId, schemas)
      e.columnCatalog = catalogRecord(schemas, catalog)
      commit(e)
    })
    .catch(() => {
      if (e.schemaRevision === revision) prefetch(connectionId, schemas)
    })
}

/**
 * Eagerly load columns for the first {@link PREFETCH_CAP} tables so autocomplete has column
 * data. Queued through the shared budget rather than fired all at once — see
 * {@link COLUMN_LOAD_CONCURRENCY} for why the difference is not academic.
 */
function prefetch(connectionId: string, schemas: DbSchemas): void {
  const groups = Object.entries(schemas)
  const single = groups.length === 1
  const names: Array<{ name: string; schema?: string }> = []
  for (const [schemaName, items] of groups) {
    for (const it of items) names.push({ name: it.name, schema: single ? undefined : schemaName })
  }
  ensureColumns(connectionId, names.slice(0, PREFETCH_CAP))
}

/**
 * Fetch one table's columns, resolving when the request settles. Deduped via
 * `requested`; a failure is dropped from `requested` (so a later read can retry) AND
 * recorded in `tableErrors`, which is what makes the failure VISIBLE. It used to be
 * swallowed entirely — the catch neither stored a reason nor committed, so every
 * consumer kept seeing `getTable() === undefined`, i.e. "still loading", forever: the
 * structure view, the DDL view, the tree node's `…`, the DDL dialog and the diagram
 * pill all had no way to tell a slow read from a dead one, showed no message, and
 * offered no retry. The single per-table fetch path shared by eager prefetch,
 * on-expand loads, and the search-driven {@link ensureColumns} loader.
 */
function loadTableInto(
  connectionId: string,
  e: Entry,
  table: string,
  schema?: string,
): Promise<void> {
  const key = schemaTableKey(table, schema)
  if (e.requested.has(key)) return Promise.resolve()
  e.requested.add(key)
  const revision = e.tableRevisions.get(key) ?? 0
  const schemaRevision = e.schemaRevision
  return databaseApi
    .tableSchema(connectionId, table, schema)
    .then((t) => {
      if (e.schemaRevision !== schemaRevision || (e.tableRevisions.get(key) ?? 0) !== revision)
        return
      clearTableError(e, key)
      stageTable(e, key, t)
    })
    .catch((err: unknown) => {
      // Stale response (the connection reloaded, or this object was re-read): the
      // newer attempt owns both the cache slot and the error slot.
      if (e.schemaRevision !== schemaRevision || (e.tableRevisions.get(key) ?? 0) !== revision)
        return
      e.requested.delete(key)
      e.tableErrors = { ...e.tableErrors, [key]: errorMessage(err) }
      const detail = detailOf(err)
      if (detail) e.tableErrorDetails = { ...e.tableErrorDetails, [key]: detail }
      scheduleCommit(e)
    })
}

/**
 * The INTERACTIVE per-table read (a node expanded, a structure/DDL view opened): issued
 * directly, never queued. Making a click wait behind a background prefetch of up to
 * {@link PREFETCH_CAP} tables would trade a real user's latency for a budget that exists to
 * protect them.
 */
export function loadTable(connectionId: string, table: string, schema?: string): void {
  if (!connectionId) return
  void loadTableInto(connectionId, getEntry(connectionId), table, schema)
}

/** Invalidate and re-read one object without flushing the entire connection tree. */
export function reloadTable(connectionId: string, table: string, schema?: string): void {
  if (!connectionId) return
  const e = getEntry(connectionId)
  const key = schemaTableKey(table, schema)
  e.tableRevisions.set(key, (e.tableRevisions.get(key) ?? 0) + 1)
  e.requested.delete(key)
  // A structure staged earlier in this task is exactly as stale as a committed one.
  e.stagedTables.delete(key)
  const hadTable = Object.hasOwn(e.tables, key)
  const hadError = Object.hasOwn(e.tableErrors, key)
  if (hadTable) {
    const { [key]: _stale, ...rest } = e.tables
    e.tables = rest
  }
  // Drop the recorded failure BEFORE re-reading: consumers branch on the error ahead
  // of the spinner, so leaving it set would keep the error card on screen for the
  // whole retry and make the Retry button look inert.
  clearTableError(e, key)
  if (hadTable || hadError) commit(e)
  void loadTableInto(connectionId, e, table, schema)
}

/**
 * Ensure columns are loaded for `wanted` tables so a global column search can match
 * them, keeping at most {@link COLUMN_LOAD_CONCURRENCY} fetches in flight. Reuses
 * the same per-table fetch + cache + dedup as {@link loadTable} (no separate fetch
 * path) — tables already loaded/loading are skipped — so it is safe to call
 * repeatedly as the filter query grows. A no-op when nothing new needs loading.
 */
export function ensureColumns(
  connectionId: string,
  wanted: Array<{ name: string; schema?: string }>,
): void {
  if (!connectionId) return
  const e = getEntry(connectionId)
  for (const w of wanted) {
    const key = schemaTableKey(w.name, w.schema)
    if (e.requested.has(key) || e.queuedKeys.has(key) || Object.hasOwn(e.columnCatalog, key))
      continue
    e.queuedKeys.add(key)
    e.columnQueue.push(w)
  }
  pumpColumnQueue(connectionId, e)
}

/** Drain the column queue up to the concurrency cap; each finished load pumps the next. */
function pumpColumnQueue(connectionId: string, e: Entry): void {
  // A schema response may settle after its last visible consumer unsubscribed. Keep
  // already-started reads, but park the remaining autocomplete prefetch until a
  // consumer returns. Direct store-level ensureColumns calls made before any
  // subscription retain their existing eager behaviour.
  if (e.fetchStarted && e.listeners.size === 0) return
  while (e.columnsInFlight < COLUMN_LOAD_CONCURRENCY && e.columnHead < e.columnQueue.length) {
    // A read cursor, not `shift()`: shifting a 5,000-entry array re-indexes it on every take.
    const next = e.columnQueue[e.columnHead++]!
    const key = schemaTableKey(next.name, next.schema)
    e.queuedKeys.delete(key)
    if (e.requested.has(key)) continue
    e.columnsInFlight += 1
    void loadTableInto(connectionId, e, next.name, next.schema).finally(() => {
      e.columnsInFlight -= 1
      pumpColumnQueue(connectionId, e)
    })
  }
  if (e.columnHead >= e.columnQueue.length) {
    e.columnQueue = []
    e.columnHead = 0
  }
}

export function reload(connectionId: string): void {
  if (!connectionId) return
  const e = getEntry(connectionId)
  resetEntry(e)
  commit(e)
  fetchSchemas(connectionId, e)
}

/**
 * Drop any cached schema for a connection so the NEXT read re-introspects the live
 * driver instead of a stale snapshot. Called when a connection is (re)established:
 * after a backend restart the browser keeps the pre-restart entry (holding either an
 * old schema OR a cached `connection_not_found` error from while the driver was down),
 * and the one-shot `fetchStarted` guard would otherwise refuse to re-fetch on reconnect
 * until a manual reload. If there are live subscribers we re-fetch immediately to serve
 * them; with none, we reset `fetchStarted` so the upcoming `subscribe` fetches fresh.
 * A no-op when nothing is cached for the connection yet.
 */
export function invalidate(connectionId: string): void {
  if (!connectionId) return
  const e = entries.get(connectionId)
  if (!e) return
  resetEntry(e)
  commit(e)
  if (e.listeners.size > 0) fetchSchemas(connectionId, e)
}

export const schemaStore = {
  subscribe(connectionId: string, cb: () => void): () => void {
    if (!connectionId) return () => {}
    const e = getEntry(connectionId)
    e.listeners.add(cb)
    if (!e.fetchStarted) fetchSchemas(connectionId, e)
    else pumpColumnQueue(connectionId, e)
    return () => {
      e.listeners.delete(cb)
    }
  },
  getSnapshot(connectionId: string): SchemaSnapshot {
    if (!connectionId) return EMPTY
    return getEntry(connectionId).snapshot
  },
  loadTable,
  reloadTable,
  ensureColumns,
  reload,
  invalidate,
}
