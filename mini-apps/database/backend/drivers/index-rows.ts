/**
 * Pure grouping helper shared by the row-per-column index introspection paths
 * (postgres/mysql/mssql). Each engine returns one row per (index, column) pair with a
 * key ordinal; this folds them into `DbIndex[]` with columns in key order. Kept pure +
 * engine-agnostic so it can be unit-tested without a live database.
 */
import type { DbIndex } from './port'

/** One flat index-membership row from an engine's introspection query. */
export interface IndexRow {
  /** Index name (grouping key). */
  name: string
  /** The column participating in the index. */
  column: string
  /** 1-based position of `column` within the index key. */
  seq: number
  unique: boolean
  primary?: boolean
  constraint?: boolean
  included?: boolean
  descending?: boolean
  prefixLength?: number | null
  clustered?: boolean
  predicate?: string
  createScript?: string
  createScriptOnly?: boolean
  inherited?: boolean
}

/**
 * Group flat `(index, column, seq)` rows into `DbIndex[]`. Columns are ordered by `seq`;
 * indexes preserve first-seen order. `unique`/`primary` are taken from the first row of
 * each index (they're constant per index).
 */
export function groupIndexRows(rows: IndexRow[]): DbIndex[] {
  const byName = new Map<
    string,
    {
      index: DbIndex
      keys: Array<{
        column: string
        seq: number
        descending?: boolean
        prefixLength?: number | null
      }>
      included: Array<{ column: string; seq: number }>
    }
  >()
  for (const r of rows) {
    let entry = byName.get(r.name)
    if (!entry) {
      entry = {
        index: {
          name: r.name,
          columns: [],
          unique: r.unique,
          primary: r.primary,
          ...(r.constraint ? { constraint: true } : {}),
          ...(r.clustered ? { clustered: true } : {}),
          ...(r.predicate ? { predicate: r.predicate } : {}),
          ...(r.createScript ? { createScript: r.createScript } : {}),
          ...(r.createScriptOnly ? { createScriptOnly: true } : {}),
          ...(r.inherited ? { inherited: true } : {}),
        },
        keys: [],
        included: [],
      }
      byName.set(r.name, entry)
    }
    if (r.included) entry.included.push({ column: r.column, seq: r.seq })
    else
      entry.keys.push({
        column: r.column,
        seq: r.seq,
        descending: r.descending,
        prefixLength: r.prefixLength,
      })
  }
  const out: DbIndex[] = []
  for (const { index, keys, included } of byName.values()) {
    keys.sort((a, b) => a.seq - b.seq)
    index.columns = keys.map((key) => key.column)
    if (keys.some((key) => key.descending !== undefined))
      index.orders = keys.map((key) => (key.descending ? 'desc' : 'asc'))
    if (keys.some((key) => key.prefixLength !== undefined))
      index.prefixLengths = keys.map((key) => key.prefixLength ?? null)
    if (included.length > 0)
      index.includeColumns = included.sort((a, b) => a.seq - b.seq).map((item) => item.column)
    out.push(index)
  }
  return out
}
