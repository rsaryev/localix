import type { DbDialect } from '../dbClient'

// The quoting rule has ONE owner, in the backend beside the type it renders — the same
// boundary `../../backend/ddl` already crosses. Re-exported so this module's callers (and
// its tests) keep their import.
export { quoteIdent } from '../../backend/sql-ident'
import { quoteIdent } from '../../backend/sql-ident'

/** Schema-aware `SELECT *` in the dialect's row-limit syntax. */
export function selectTableSql(
  target: { table: string; schema?: string; dialect: DbDialect },
  limit = 200,
): string {
  const table = quoteIdent(target.table, target.dialect)
  const ident = target.schema ? `${quoteIdent(target.schema, target.dialect)}.${table}` : table
  if (target.dialect === 'mssql') return `SELECT TOP ${limit} * FROM ${ident};`
  return `SELECT * FROM ${ident} LIMIT ${limit};`
}
