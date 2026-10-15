/**
 * The schema cache's RECORD: one connection's entry, the immutable snapshot consumers
 * read, and the rules for recording a failure on it.
 *
 * Separate from `schemaStore.ts` because that file is about WHEN to fetch (one shared
 * fetch, a lazy per-table cache, a concurrency-capped background loader), and this one
 * is about WHAT is held and how a reader sees it. Every mutation in the store ends in
 * {@link commit}, which is the only place a new snapshot is minted and listeners are
 * told — keeping that rule in one small file is what makes it checkable.
 */

import type { DbCatalogColumn, DbSchemas, DbTableSchema } from '../dbClient'
import { DbApiError } from '../api/databaseApi'
import { defineRecordValue } from '../../shared/safe-record'

export interface SchemaSnapshot {
  schemas: DbSchemas | null
  loading: boolean
  error: string | null
  /**
   * The raw driver text behind {@link error}. The backend classifies (`{ error, code, detail }`)
   * and the sentence is what a surface shows; without this slot the driver's own words — the only
   * thing an operator can act on — were dropped at the client edge.
   */
  errorDetail: string | null
  tables: Record<string, DbTableSchema>
  /**
   * Why a per-object introspection failed, keyed exactly like {@link tables}. A key
   * present here means "asked, failed, not retrying by itself" — the state a consumer
   * must render as an error with a retry, never as a spinner.
   */
  tableErrors: Record<string, string>
  /** Raw driver text per failed object, keyed exactly like {@link tableErrors}. */
  tableErrorDetails: Record<string, string>
  /**
   * Column names for every table from ONE catalog read, keyed exactly like {@link tables}. Feeds
   * autocomplete, column search and diagnostics only — never a structure view, which needs the
   * full per-table read. Empty when the engine has no catalog read.
   */
  columnCatalog: Record<string, ColumnSource>
}

/** The part of a structure the vocabulary consumers read. */
export interface ColumnSource {
  schema?: string
  name: string
  columns: readonly Pick<DbCatalogColumn, 'name' | 'dataType' | 'pk'>[]
}

export interface Entry extends SchemaSnapshot {
  requested: Set<string>
  /** Per-object invalidation generation; stale in-flight responses are discarded. */
  tableRevisions: Map<string, number>
  /** Connection-wide invalidation generation for reload/reconnect races. */
  schemaRevision: number
  fetchStarted: boolean
  listeners: Set<() => void>
  snapshot: SchemaSnapshot
  /** Tables a background loader still wants columns for (FIFO). */
  columnQueue: Array<{ name: string; schema?: string }>
  /** Read cursor into {@link columnQueue}; entries before it have been taken. */
  columnHead: number
  /**
   * Keys currently in {@link columnQueue}. A linear `columnQueue.some(...)` per wanted table made
   * one `ensureColumns` over N tables O(N²) before a single request went out.
   */
  queuedKeys: Set<string>
  /** Background column fetches currently in flight (≤ COLUMN_LOAD_CONCURRENCY). */
  columnsInFlight: number
  /** Structures that arrived since the last snapshot, folded in by the next {@link commit}. */
  stagedTables: Map<string, DbTableSchema>
  /** A coalesced {@link commit} is already queued for this entry. */
  commitScheduled: boolean
}

export const EMPTY: SchemaSnapshot = {
  schemas: null,
  loading: false,
  error: null,
  errorDetail: null,
  tables: {},
  tableErrors: {},
  tableErrorDetails: {},
  columnCatalog: {},
}
export const entries = new Map<string, Entry>()

export function getEntry(connectionId: string): Entry {
  let e = entries.get(connectionId)
  if (!e) {
    e = {
      schemas: null,
      loading: true,
      error: null,
      errorDetail: null,
      tables: {},
      tableErrors: {},
      tableErrorDetails: {},
      columnCatalog: {},
      requested: new Set(),
      tableRevisions: new Map(),
      schemaRevision: 0,
      fetchStarted: false,
      listeners: new Set(),
      columnQueue: [],
      columnHead: 0,
      queuedKeys: new Set(),
      columnsInFlight: 0,
      stagedTables: new Map(),
      commitScheduled: false,
      snapshot: {
        schemas: null,
        loading: true,
        error: null,
        errorDetail: null,
        tables: {},
        tableErrors: {},
        tableErrorDetails: {},
        columnCatalog: {},
      },
    }
    entries.set(connectionId, e)
  }
  return e
}

export function commit(e: Entry): void {
  foldStagedTables(e)
  e.snapshot = {
    schemas: e.schemas,
    loading: e.loading,
    error: e.error,
    errorDetail: e.errorDetail,
    tables: e.tables,
    tableErrors: e.tableErrors,
    tableErrorDetails: e.tableErrorDetails,
    columnCatalog: e.columnCatalog,
  }
  for (const l of e.listeners) l()
}

/**
 * Record one arrived structure and schedule ONE commit for everything that lands in the same task.
 *
 * The defect this stops: every column load used to copy `e.tables` whole and commit on its own —
 * O(n) per load, so a prefetch of 150 tables or a search that introspects thousands was O(n²) in
 * copying and minted one snapshot (one render of every subscriber) per table. Staged structures
 * are folded into a SINGLE copy by the next commit, and a commit that some other mutation issues
 * in between folds them too, so the queued one then finds nothing to do.
 */
export function stageTable(e: Entry, key: string, table: DbTableSchema): void {
  e.stagedTables.set(key, table)
  scheduleCommit(e)
}

/** Queue one microtask commit per entry; further calls in the same task join it. */
export function scheduleCommit(e: Entry): void {
  if (e.commitScheduled) return
  e.commitScheduled = true
  queueMicrotask(() => {
    if (!e.commitScheduled) return
    commit(e)
  })
}

function foldStagedTables(e: Entry): void {
  e.commitScheduled = false
  if (e.stagedTables.size === 0) return
  const next = { ...e.tables }
  // defineRecordValue: an object named `__proto__` is data, not a prototype assignment.
  for (const [key, table] of e.stagedTables) defineRecordValue(next, key, table)
  e.stagedTables.clear()
  e.tables = next
}

/** The driver's own words, when the typed backend sent them alongside the sentence. */
export function detailOf(err: unknown): string | null {
  return err instanceof DbApiError ? (err.detail ?? null) : null
}

export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.trim() || 'Could not read this object.'
}

/** Drop a recorded failure, without allocating when there is nothing to drop. */
export function clearTableError(e: Entry, key: string): void {
  if (Object.hasOwn(e.tableErrorDetails, key)) {
    const { [key]: _clearedDetail, ...restDetails } = e.tableErrorDetails
    e.tableErrorDetails = restDetails
  }
  if (!Object.hasOwn(e.tableErrors, key)) return
  const { [key]: _cleared, ...rest } = e.tableErrors
  e.tableErrors = rest
}

/**
 * Invalidate everything held for one connection, in the ONE place both callers share.
 *
 * `reload` (a person asked) and `invalidate` (the connection was re-established) differ
 * only in what they do afterwards — re-fetch now, or leave `fetchStarted` false so the
 * next subscriber fetches. What they clear must not differ, and did not use to be
 * written down anywhere: a slot added to the snapshot and cleared in only one of them
 * is how a stale error survives a reconnect.
 */
export function resetEntry(e: Entry): void {
  e.schemaRevision += 1
  e.schemas = null
  e.loading = true
  e.error = null
  e.errorDetail = null
  e.tables = {}
  e.tableErrors = {}
  e.tableErrorDetails = {}
  e.columnCatalog = {}
  e.requested.clear()
  e.tableRevisions.clear()
  e.columnQueue = []
  e.columnHead = 0
  e.queuedKeys.clear()
  e.stagedTables.clear()
  e.fetchStarted = false
}
