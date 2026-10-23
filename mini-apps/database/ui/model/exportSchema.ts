// Orchestrate a whole-connection schema dump: fetch every table's full schema (the tree
// only lazy-loads expanded ones) and build a faithful CREATE dump. Thin async glue over
// databaseApi; the string-building lives in the pure, tested buildSchemaDump.
import { databaseApi } from '../api/databaseApi'
import { buildSchemaDump } from './schemaDDL'
import type { DbDialect } from '../dbClient'

export interface SchemaEntry {
  name: string
  /** Owning schema (undefined for single-schema engines like sqlite). */
  schema?: string
}

/** Fetch each entry's full schema and return the concatenated CREATE dump. */
export async function fetchSchemaDump(
  connectionId: string,
  entries: SchemaEntry[],
  dialect: DbDialect,
): Promise<string> {
  const tables = await Promise.all(
    entries.map((e) => databaseApi.tableSchema(connectionId, e.name, e.schema)),
  )
  return buildSchemaDump(tables, dialect)
}
