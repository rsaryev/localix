/**
 * MySQL's compile-only check: COM_STMT_PREPARE, then drop the statement, never execute.
 *
 * Preparing parses the statement and, for DML, resolves its tables and columns (MySQL
 * reference, "Prepared Statements" / "SQL Syntax Permitted in Prepared Statements"), so it
 * reports a syntax error AND an unknown table/column. Preparable DDL (`CREATE TABLE`,
 * `DROP TABLE` …) is parsed without running (verified: a prepared `DROP TABLE` leaves the
 * table). Statements outside the prepared protocol (`BEGIN`, `CREATE PROCEDURE`, `LOAD DATA`
 * …) answer ER_UNSUPPORTED_PS (1295), which is no verdict on the SQL.
 *
 * mysql2 caches every prepared statement per connection and `PreparedStatementInfo.close()`
 * frees the server handle WITHOUT evicting that cache entry — a later `execute()` of the same
 * text on that pooled connection would reuse the closed handle. `unprepare(sql)` removes the
 * entry and closes the handle together, so it is the only safe way to throw one away.
 *
 * MySQL reports no character position, only `… near '<rest of text>' at line N`; the offset
 * is where that echoed rest starts on line N.
 */
import type { DbValidation } from './validation'

const ER_PARSE_ERROR = 1064
const ER_SYNTAX_ERROR = 1149
const ER_UNSUPPORTED_PS = 1295
const NEAR = /'([\s\S]*)' at line (\d+)$/

/** The slice of a mysql2 promise connection the check needs (structural, for tests). */
export interface MysqlPreparer {
  prepare(sql: string): Promise<unknown>
  unprepare(sql: string): unknown
}

function parseErrorOffset(sql: string, message: string): number | undefined {
  const match = NEAR.exec(message)
  if (!match) return undefined
  const rest = match[1]!
  const lines = sql.split('\n')
  const lineIndex = Number(match[2]) - 1
  if (lineIndex < 0 || lineIndex >= lines.length) return undefined
  const lineStart = lines.slice(0, lineIndex).reduce((sum, text) => sum + text.length + 1, 0)
  if (!rest) return sql.trimEnd().length
  const found = sql.indexOf(rest, lineStart)
  return found >= 0 ? found : undefined
}

/**
 * The server's verdict on a failed prepare, or `null` when the failure was not the server's
 * judgement of the SQL (a lost connection has no `sqlState`).
 */
export function mysqlValidationFromError(sql: string, err: unknown): DbValidation | null {
  const detail = err as { errno?: unknown; sqlState?: unknown; code?: unknown } | null
  if (typeof detail?.errno !== 'number' || typeof detail.sqlState !== 'string') return null
  if (detail.errno === ER_UNSUPPORTED_PS) return { ok: true, skipped: 'unsupported' }
  const message = err instanceof Error ? err.message : String(err)
  const syntax = detail.errno === ER_PARSE_ERROR || detail.errno === ER_SYNTAX_ERROR
  const offset = syntax ? parseErrorOffset(sql, message) : undefined
  return {
    ok: false,
    message,
    code: typeof detail.code === 'string' ? detail.code : String(detail.errno),
    ...(offset !== undefined ? { offset } : {}),
    ...(syntax ? {} : { semantic: true }),
  }
}

export async function compileMysqlStatement(
  connection: MysqlPreparer,
  sql: string,
): Promise<DbValidation> {
  try {
    await connection.prepare(sql)
    connection.unprepare(sql)
    return { ok: true }
  } catch (err) {
    return mysqlValidationFromError(sql, err) ?? { ok: true, skipped: 'busy' }
  }
}
