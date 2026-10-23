import { quoteIdent } from '../sql-ident'
import type { DbBrowseRequest, DbDialect } from './port'

/** Build the bounded SELECT used by relational adapters for the structured browse port.
 * Identifiers are always quoted and pagination values are clamped integers, so this
 * path never interpolates executable user text. */
export function buildSqlBrowseQuery(dialect: DbDialect, request: DbBrowseRequest): string {
  const table = quoteIdent(request.table, dialect)
  const target = request.schema ? `${quoteIdent(request.schema, dialect)}.${table}` : table
  const limit = Math.max(1, Math.min(500, Math.trunc(request.limit)))
  const offset = Math.max(0, Math.trunc(request.offset))
  const order = request.sort
    ? `ORDER BY ${quoteIdent(request.sort.column, dialect)} ${request.sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    : dialect === 'mssql'
      ? 'ORDER BY (SELECT NULL)'
      : ''
  if (dialect === 'mssql') {
    return `SELECT * FROM ${target} ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`
  }
  return `SELECT * FROM ${target}${order ? ` ${order}` : ''} LIMIT ${limit} OFFSET ${offset};`
}
