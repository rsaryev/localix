import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { DbSchemas, DbTableSchema } from '../dbClient'
import type { SqlForeignKey, SqlSchemaModel } from './sqlCompletion'
import { getCachedTable, getCachedTableError, mergeColumnSources } from './schemaKey'
import type { ColumnSource } from './schemaEntry'
import { schemaStore } from './schemaStore'
import { defineRecordValue, ownRecordValue } from '../../shared/safe-record'

export interface SchemaState {
  schemas: DbSchemas | null
  loading: boolean
  error: string | null
  /** The raw driver text behind {@link error}. Event Center only, never a headline. */
  errorDetail: string | null
  reload: () => void
  /** Lazily-fetched structures. Use getTable for schema-safe lookup. */
  tables: Record<string, DbTableSchema>
  getTable: (table: string, schema?: string) => DbTableSchema | undefined
  /**
   * Column vocabulary for every table known so far — full structures plus the one-query catalog.
   * For autocomplete, search and diagnostics; a structure view reads {@link getTable}.
   */
  columnSources: Record<string, ColumnSource>
  getColumnSource: (table: string, schema?: string) => ColumnSource | undefined
  /**
   * Why this object's structure could not be read, when it could not. A consumer that
   * renders a spinner for a missing table MUST check this first — an absent table with
   * an error is a dead end, not a slow read, and only `reloadTable` re-tries it.
   */
  getTableError: (table: string, schema?: string) => string | undefined
  /** The raw driver text behind {@link getTableError}, when the backend sent one. */
  getTableErrorDetail: (table: string, schema?: string) => string | undefined
  loadTable: (table: string, schema?: string) => void
  reloadTable: (table: string, schema?: string) => void
  /**
   * Prefetch columns for a set of tables (concurrency-capped) so a global column
   * search can match them. Reuses the lazy per-table loader; safe to call repeatedly.
   */
  ensureColumns: (wanted: Array<{ name: string; schema?: string }>) => void
  /** Flat vocabulary for schema-aware SQL autocomplete (tables + loaded columns). */
  model: SqlSchemaModel
}

/** The flat vocabulary for SQL autocomplete: table names, loaded columns, foreign keys. */
function buildSchemaModel(
  schemas: DbSchemas | null,
  tables: Record<string, DbTableSchema>,
  columnSources: Record<string, ColumnSource>,
): SqlSchemaModel {
  const tableNames: string[] = []
  if (schemas)
    for (const items of Object.values(schemas)) for (const it of items) tableNames.push(it.name)
  const columnsByTable: Record<string, string[]> = {}
  const columnMeta: Record<string, Record<string, { type?: string; pk?: boolean }>> = {}
  const foreignKeys: SqlForeignKey[] = []
  for (const source of Object.values(columnSources)) {
    const names = source.schema ? [`${source.schema}.${source.name}`, source.name] : [source.name]
    const columns = source.columns.map((c) => c.name)
    const meta = Object.fromEntries(
      source.columns.map((c) => [c.name, { type: c.dataType, pk: c.pk }]),
    )
    for (const name of names) {
      if (!ownRecordValue(columnsByTable, name)) defineRecordValue(columnsByTable, name, columns)
      if (!ownRecordValue(columnMeta, name)) defineRecordValue(columnMeta, name, meta)
    }
  }
  for (const t of Object.values(tables)) {
    for (const fk of t.foreignKeys) {
      foreignKeys.push({
        table: t.schema ? `${t.schema}.${t.name}` : t.name,
        columns: fk.columns,
        refTable: fk.refSchema ? `${fk.refSchema}.${fk.refTable}` : fk.refTable,
        refColumns: fk.refColumns,
      })
    }
  }
  return { tables: tableNames, columnsByTable, columnMeta, foreignKeys }
}

/**
 * Live schema for one connection: the tables/views tree (eager) plus a lazy
 * per-table column cache. Backed by the shared {@link schemaStore} so every
 * consumer of the same connection (sidebar tree, open console autocomplete, .sql
 * editor) shares ONE fetch — and a reload from any of them refreshes all.
 */
export function useSchema(connectionId: string): SchemaState {
  const workItemVisible = useWorkItemVisible()
  const snap = useSyncExternalStore(
    useCallback(
      (cb) => (workItemVisible ? schemaStore.subscribe(connectionId, cb) : () => {}),
      [connectionId, workItemVisible],
    ),
    useCallback(() => schemaStore.getSnapshot(connectionId), [connectionId]),
  )

  const reload = useCallback(() => {
    if (workItemVisible) schemaStore.reload(connectionId)
  }, [connectionId, workItemVisible])
  const loadTable = useCallback(
    (table: string, schema?: string) => {
      if (workItemVisible) schemaStore.loadTable(connectionId, table, schema)
    },
    [connectionId, workItemVisible],
  )
  const getTable = useCallback(
    (table: string, schema?: string) => getCachedTable(snap.tables, table, schema),
    [snap.tables],
  )
  const columnSources = useMemo(
    () => mergeColumnSources<ColumnSource>(snap.columnCatalog, snap.tables),
    [snap.columnCatalog, snap.tables],
  )
  const getColumnSource = useCallback(
    (table: string, schema?: string) => getCachedTable(columnSources, table, schema),
    [columnSources],
  )
  const getTableError = useCallback(
    (table: string, schema?: string) => getCachedTableError(snap.tableErrors, table, schema),
    [snap.tableErrors],
  )
  const getTableErrorDetail = useCallback(
    (table: string, schema?: string) => getCachedTableError(snap.tableErrorDetails, table, schema),
    [snap.tableErrorDetails],
  )
  const reloadTable = useCallback(
    (table: string, schema?: string) => {
      if (workItemVisible) schemaStore.reloadTable(connectionId, table, schema)
    },
    [connectionId, workItemVisible],
  )
  const ensureColumns = useCallback(
    (wanted: Array<{ name: string; schema?: string }>) => {
      if (workItemVisible) schemaStore.ensureColumns(connectionId, wanted)
    },
    [connectionId, workItemVisible],
  )

  const model = useMemo(
    () => buildSchemaModel(snap.schemas, snap.tables, columnSources),
    [snap.schemas, snap.tables, columnSources],
  )

  return {
    schemas: snap.schemas,
    loading: snap.loading,
    error: snap.error,
    errorDetail: snap.errorDetail,
    reload,
    tables: snap.tables,
    getTable,
    columnSources,
    getColumnSource,
    getTableError,
    getTableErrorDetail,
    loadTable,
    reloadTable,
    ensureColumns,
    model,
  }
}
