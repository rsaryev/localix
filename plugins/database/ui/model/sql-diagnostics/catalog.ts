/**
 * What the diagnostics know about the connected database, and — just as important — what they
 * do NOT know yet.
 *
 * The schema tree loads eagerly but a table's columns load lazily, one table at a time. Judging
 * a column against a table whose columns have not arrived would flag every column of it, so the
 * catalog answers `undefined` ("not loaded") separately from `[]`, and the checks stand down on
 * `undefined` while `wantColumns` asks for them.
 */
import type { DbSchemas } from '../../dbClient'

export interface SqlCatalog {
  /** Resolve a relation's parts to the tables it may mean; `null` = cannot judge this name. */
  resolve(parts: readonly string[]): SqlCatalogTable[] | null
  /** Every relation name, for "did you mean". */
  tableNames(): string[]
}

export interface SqlCatalogTable {
  schema: string
  name: string
  /** Lower-cased column names, or `undefined` while this table's structure is not loaded. */
  columns: ReadonlySet<string> | undefined
  /** Column names as the catalog spells them, for "did you mean". */
  columnNames: readonly string[]
}

/**
 * System relations every engine resolves without listing them in the user's tree:
 * `pg_tables` through the search path, `sqlite_master`, MySQL's `dual`.
 * Flagging them would be a false error on a query that runs.
 */
const SYSTEM_RELATION = /^(?:pg_|sqlite_|information_schema$|dual$|sys$|system$)/i

export function createSqlCatalog(
  schemas: DbSchemas | null,
  getTable: (
    table: string,
    schema?: string,
  ) => { columns: readonly { name: string }[] } | undefined,
): SqlCatalog | null {
  if (!schemas) return null
  const bySchema = new Map<string, Map<string, { schema: string; name: string }>>()
  for (const [schema, items] of Object.entries(schemas)) {
    const map = new Map<string, { schema: string; name: string }>()
    for (const item of items) map.set(item.name.toLowerCase(), { schema, name: item.name })
    bySchema.set(schema.toLowerCase(), map)
  }
  const table = (entry: { schema: string; name: string }): SqlCatalogTable => {
    const loaded = getTable(entry.name, entry.schema || undefined)
    const names = loaded?.columns.map((column) => column.name) ?? []
    return {
      ...entry,
      columns: loaded ? new Set(names.map((name) => name.toLowerCase())) : undefined,
      columnNames: names,
    }
  }
  return {
    resolve(parts) {
      const name = parts.at(-1)!.toLowerCase()
      if (parts.length > 2 || SYSTEM_RELATION.test(name)) return null
      if (parts.length === 2) {
        const schema = parts[0]!.toLowerCase()
        // An unlisted qualifier may be another database or a catalog — not ours to judge.
        if (SYSTEM_RELATION.test(schema)) return null
        const inSchema = bySchema.get(schema)
        if (!inSchema) return null
        const hit = inSchema.get(name)
        return hit ? [table(hit)] : []
      }
      const hits: SqlCatalogTable[] = []
      for (const inSchema of bySchema.values()) {
        const hit = inSchema.get(name)
        if (hit) hits.push(table(hit))
      }
      return hits
    },
    tableNames() {
      return [...bySchema.values()].flatMap((inSchema) => [...inSchema.values()].map((t) => t.name))
    },
  }
}
