/** Debounced table/column filtering over the schema tree: wraps the unfiltered tree in the uniform
 *  match shape, matches NAMES by default, and matches columns only when asked to. */
import { useEffect, useMemo, useState } from 'react'
import type { DbSchemaItem } from '../../dbClient'
import { searchSchemas, type SchemaItemMatch } from '../../model/schemaSearch'
import type { SchemaState } from '../../model/useSchema'

/** Stable empty column list for the unfiltered tree, so wrapping doesn't churn refs. */
const NO_COLUMNS: string[] = []
/** Name-only search reads no column cache at all, so column loads don't re-run the match. */
const NO_TABLES: SchemaState['columnSources'] = {}

/**
 * How many objects a column search introspects. The defect it bounds: the first keystroke in the
 * filter used to load the columns of EVERY table so a column name could match — 5,000 requests
 * for a person who was typing a table name. Column search is now an explicit toggle, and even then
 * it reads at most this many objects (through the store's shared, capped lane) and says so.
 */
export const COLUMN_SEARCH_CAP = 500
/** Quiet period before a column search starts reading, so a toggle-then-type does not fire twice. */
export const COLUMN_SEARCH_DEBOUNCE_MS = 400

export type SchemaGroups = Array<readonly [string, DbSchemaItem[]]>

/** The objects a column search reads, in tree order, bounded by {@link COLUMN_SEARCH_CAP}. */
export function columnSearchTargets(
  groups: SchemaGroups,
  single: boolean,
  cap = COLUMN_SEARCH_CAP,
): Array<{ name: string; schema?: string }> {
  const wanted: Array<{ name: string; schema?: string }> = []
  for (const [schemaName, items] of groups) {
    for (const item of items) {
      if (wanted.length >= cap) return wanted
      wanted.push({ name: item.name, schema: single ? undefined : schemaName })
    }
  }
  return wanted
}

export function useSchemaFilter(schema: SchemaState) {
  const groups = useMemo<SchemaGroups>(
    () => (schema.schemas ? Object.entries(schema.schemas) : []),
    [schema.schemas],
  )
  const single = groups.length === 1
  const [filter, setFilter] = useState('')
  const [searchColumns, setSearchColumns] = useState(false)
  // Debounce the query that drives matching (typing stays snappy); clearing restores the full
  // tree immediately.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(filter), filter ? 160 : 0)
    return () => clearTimeout(id)
  }, [filter])
  const q = debounced.trim()
  const searchActive = q.length > 0
  const totalTables = groups.reduce((n, [, items]) => n + items.length, 0)

  const { ensureColumns } = schema
  const targets = useMemo(
    () => (searchColumns ? columnSearchTargets(groups, single) : []),
    [searchColumns, groups, single],
  )
  useEffect(() => {
    if (!searchActive || targets.length === 0) return
    const id = setTimeout(() => ensureColumns(targets), COLUMN_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchActive, targets, ensureColumns])

  // Uniform match shape for rendering. Unfiltered: wrap every item as a plain name "match"
  // (memoized on `groups` alone so lazy column loads don't re-wrap the tree).
  const wrappedGroups = useMemo<Array<readonly [string, SchemaItemMatch[]]>>(
    () =>
      groups.map(
        ([name, items]) =>
          [
            name,
            items.map((item) => ({ item, reason: 'name' as const, matchedColumns: NO_COLUMNS })),
          ] as const,
      ),
    [groups],
  )
  const columnTables = searchColumns ? schema.columnSources : NO_TABLES
  const searchResult = useMemo(
    () => (searchActive ? searchSchemas(schema.schemas ?? {}, columnTables, q) : null),
    [searchActive, schema.schemas, columnTables, q],
  )
  const filtered = searchActive ? (searchResult?.groups ?? []) : wrappedGroups

  return {
    groups,
    single,
    filter,
    setFilter,
    searchActive,
    filtered,
    totalTables,
    searchColumns,
    setSearchColumns,
    /** How many objects a column search covers — fewer than `totalTables` when capped. */
    columnSearchScope: Math.min(totalTables, COLUMN_SEARCH_CAP),
  }
}
