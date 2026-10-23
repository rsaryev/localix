/** A foreign-key edge, flattened for join-condition suggestions. */
export interface SqlForeignKey {
  table: string
  columns: string[]
  refTable: string
  refColumns: string[]
}

/** Flat schema vocabulary the completion reads (built from the live schema tree). */
export interface SqlSchemaModel {
  /** All table/view names. */
  tables: string[]
  /** table name → its column names. */
  columnsByTable: Record<string, string[]>
  /** Foreign-key edges across the loaded tables — powers JOIN … ON suggestions. */
  foreignKeys?: SqlForeignKey[]
  /** Per-column metadata (type + PK) → shown in the completion detail. Optional. */
  columnMeta?: Record<string, Record<string, { type?: string; pk?: boolean }>>
}
