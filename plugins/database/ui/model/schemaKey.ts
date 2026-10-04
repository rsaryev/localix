import type { DbTableSchema } from '../dbClient'
import { ownRecordValue } from '../../shared/safe-record'

/** Stable cache identity for an object. A bare name remains backwards-compatible
 * for engines/connections that expose only one namespace. */
export function schemaTableKey(table: string, schema?: string): string {
  return schema === undefined ? table : JSON.stringify([schema, table])
}

/** Resolve a table without letting equal object names from different schemas collide. */
export function getCachedTable(
  tables: Record<string, DbTableSchema>,
  table: string,
  schema?: string,
): DbTableSchema | undefined {
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
