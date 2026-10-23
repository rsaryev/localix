import type { DbSchemas, DbSchemaItem } from '../dbClient'
import { scoreSearchFields } from '@localixai/mini-app-sdk/ui/utilities'
import { getCachedTable } from './schemaKey'

/**
 * Global schema search for the browser sidebar: matches a query against table/view
 * NAMES *and* their COLUMN names across the whole connection, so a table surfaces
 * when it merely CONTAINS a matching column. Pure + framework-free so it can be
 * unit-tested in isolation; the sidebar owns the (lazy) loading of column data and
 * the rendering (auto-expand + highlight).
 *
 * Matching is a case-insensitive substring test. Column matches only consider
 * columns that are ALREADY loaded (columns are lazy-fetched per table); a table
 * whose columns haven't loaded yet can still match by name.
 */

/** Why an object is included: `name` = its name matched; `column` = only a column matched. */
export type SchemaMatchReason = 'name' | 'column'

export interface SchemaItemMatch {
  item: DbSchemaItem
  reason: SchemaMatchReason
  /**
   * Loaded column names (original case) that contain the query — for tinting the
   * matched columns and auto-expanding the table to reveal them. Populated for both
   * a `column` match and a `name` match that also happens to hit columns (so those
   * columns still highlight). Empty when only the name matched.
   */
  matchedColumns: string[]
}

export interface SchemaSearchResult {
  /** Filtered groups in original schema order; groups with no match are dropped. */
  groups: Array<readonly [string, SchemaItemMatch[]]>
  /** Total matched objects across all groups. */
  total: number
}

/**
 * Match one schema object against `query`. Returns null when neither the object's
 * name nor any of its loaded columns contain the query (case-insensitive). Pass
 * `columns` = the object's loaded column list, or `undefined` when not yet fetched
 * (then only the name can match). `reason` is `name` whenever the name matches —
 * even if columns also match — so the "matched by column only" hint is reserved
 * for objects that would otherwise be invisible.
 */
export function matchSchemaItem(
  item: DbSchemaItem,
  columns: readonly { name: string }[] | undefined,
  query: string,
): SchemaItemMatch | null {
  const q = query.trim()
  if (!q) return null
  const nameHit = scoreSearchFields([{ text: item.name }], q) >= 0.5
  const matchedColumns = columns
    ? columns.flatMap((column) =>
        scoreSearchFields([{ text: column.name }], q) >= 0.5 ? [column.name] : [],
      )
    : []
  if (!nameHit && matchedColumns.length === 0) return null
  return { item, reason: nameHit ? 'name' : 'column', matchedColumns }
}

/**
 * Walk the schema tree and keep every table/view whose name OR a loaded column
 * matches `query` (case-insensitive substring). A blank query returns `null` — the
 * caller should render the full, unfiltered tree instead. Column matches are drawn
 * from `tables` (the lazy per-table column cache, keyed by object name).
 */
export function searchSchemas(
  schemas: DbSchemas,
  tables: Record<string, { columns: readonly { name: string }[] }>,
  query: string,
): SchemaSearchResult | null {
  const q = query.trim()
  if (!q) return null
  const groups: Array<readonly [string, SchemaItemMatch[]]> = []
  let total = 0
  for (const [schemaName, items] of Object.entries(schemas)) {
    const matches: SchemaItemMatch[] = []
    for (const item of items) {
      const m = matchSchemaItem(item, getCachedTable(tables, item.name, schemaName)?.columns, q)
      if (m) matches.push(m)
    }
    if (matches.length > 0) {
      groups.push([schemaName, matches] as const)
      total += matches.length
    }
  }
  return { groups, total }
}
