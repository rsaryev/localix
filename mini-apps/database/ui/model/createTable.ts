import type { DbDialect } from '../dbClient'
import { quoteIdent } from './sqlIdent'

export interface CreateTableColumn {
  name: string
  dataType: string
  nullable: boolean
  primaryKey: boolean
}

export interface CreateTableDraft {
  table: string
  schema?: string
  columns: CreateTableColumn[]
}

/** Generate a reviewable CREATE TABLE statement from constrained designer input.
 * Identifiers are quoted by dialect; data types come from the canonical driver catalog. */
export function buildCreateTableSql(dialect: DbDialect, draft: CreateTableDraft): string {
  const table = draft.table.trim()
  const columns = draft.columns.filter((column) => column.name.trim())
  if (!table) throw new Error('Table name is required')
  if (columns.length === 0) throw new Error('Add at least one column')

  const target = draft.schema?.trim()
    ? `${quoteIdent(draft.schema.trim(), dialect)}.${quoteIdent(table, dialect)}`
    : quoteIdent(table, dialect)
  const primary = columns.filter((column) => column.primaryKey)
  const definitions = columns.map((column) => {
    const nullable = column.nullable && !column.primaryKey ? '' : ' NOT NULL'
    return `  ${quoteIdent(column.name.trim(), dialect)} ${column.dataType}${nullable}`
  })
  if (primary.length > 0) {
    definitions.push(
      `  PRIMARY KEY (${primary.map((column) => quoteIdent(column.name.trim(), dialect)).join(', ')})`,
    )
  }
  return `CREATE TABLE ${target} (\n${definitions.join(',\n')}\n);`
}
