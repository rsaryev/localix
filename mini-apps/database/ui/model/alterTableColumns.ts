import type { DbColumn, DbDialect } from '../dbClient'
import type { AlterColumnDraft } from './alterTable'
import { quoteIdent } from './sqlIdent'

const normalizeDefault = (value: string | null | undefined) => value?.trim() ?? ''
export const columnDefault = (column: DbColumn) => normalizeDefault(column.defaultValue)
export const changed = (base: DbColumn, draft: AlterColumnDraft) => ({
  name: base.name !== draft.name.trim(),
  type: base.dataType.trim() !== draft.dataType.trim(),
  nullable: base.nullable !== draft.nullable,
  defaultValue: columnDefault(base) !== draft.defaultValue.trim(),
})

export const qualifiedTable = (dialect: DbDialect, table: string, schema?: string): string => {
  const quoted = quoteIdent(table, dialect)
  return schema?.trim() ? `${quoteIdent(schema.trim(), dialect)}.${quoted}` : quoted
}

export function columnDefinition(dialect: DbDialect, draft: AlterColumnDraft): string {
  const defaultSql = draft.defaultValue.trim()
  return [
    quoteIdent(draft.name.trim(), dialect),
    draft.dataType.trim(),
    draft.nullable ? 'NULL' : 'NOT NULL',
    defaultSql ? `DEFAULT ${defaultSql}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
