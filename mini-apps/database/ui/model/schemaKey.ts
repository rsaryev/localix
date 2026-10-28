import type { DbColumnCatalog, DbSchemas, DbTableSchema } from '../dbClient'
import type { ColumnSource } from './schemaEntry'
import { defineRecordValue, ownRecordValue } from '../../shared/safe-record'

/** Stable cache identity for an object. A bare name is the key
 * for engines/connections that expose only one namespace. */
export function schemaTableKey(table: string, schema?: string): string {
  return schema === undefined ? table : JSON.stringify([schema, table])
}

/** Resolve a table without letting equal object names from different schemas collide. */
export function getCachedTable<T = DbTableSchema>(
  tables: Record<string, T>,
  table: string,
  schema?: string,
): T | undefined {
  return ownRecordValue(tables, schemaTableKey(table, schema)) ?? ownRecordValue(tables, table)
}

/**
 * Resolve a recorded introspection failure for an object. Deliberately the SAME
 * qualified-then-bare fallback as {@link getCachedTable}: the two maps are keyed
 * identically, so an error must be findable by every name that would have found the
 * table it stands in for — otherwise a failure resolves to `undefined` on one surface
 * and reads as "still loading" again.
 */
export function getCachedTableError(
  tableErrors: Record<string, string>,
  table: string,
  schema?: string,
): string | undefined {
  return (
    ownRecordValue(tableErrors, schemaTableKey(table, schema)) ?? ownRecordValue(tableErrors, table)
  )
}

/**
 * One column vocabulary from both sources: a full structure wins over the catalog's thin entry for
 * the same key, because it was read later and on purpose.
 */
export function mergeColumnSources<T extends { columns: readonly unknown[] }>(
  catalog: Record<string, T>,
  tables: Record<string, T>,
): Record<string, T> {
  if (Object.keys(catalog).length === 0) return tables
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(catalog)) defineRecordValue(out, key, value)
  for (const [key, value] of Object.entries(tables)) defineRecordValue(out, key, value)
  return out
}

/** Key catalog tables exactly like `tables`: a single-namespace tree uses bare names. */
export function catalogRecord(
  schemas: DbSchemas,
  catalog: DbColumnCatalog,
): Record<string, ColumnSource> {
  const single = Object.keys(schemas).length <= 1
  const out: Record<string, ColumnSource> = {}
  for (const t of catalog) {
    defineRecordValue(out, schemaTableKey(t.table, single ? undefined : t.schema), {
      schema: t.schema,
      name: t.table,
      columns: t.columns,
    })
  }
  return out
}
