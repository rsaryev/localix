/**
 * ClickHouse's compile-only check: `EXPLAIN AST <statement>`, sent through `command()`.
 *
 * `EXPLAIN AST` "dumps the query AST. Supports all types of queries, not only SELECT" (docs:
 * EXPLAIN Statement) and runs the parser only — nothing executes (verified: `EXPLAIN AST DROP
 * TABLE u` leaves `u`). It is therefore SYNTAX only: an unknown table or column parses fine
 * and is not reported. `EXPLAIN SYNTAX`/`PLAN` would resolve names, but they accept only
 * SELECT. Sent through `command()` because `query()` appends a `FORMAT` clause, which is
 * itself a syntax error after `SYSTEM …` and other statements that take none.
 *
 * Only SYNTAX_ERROR (code 62) is a verdict on the SQL. Any other code is raised after a
 * successful parse — an unset `{name:Type}` substitution (456) is the common one — and says
 * the statement parsed. The server's position is a 1-based UTF-8 BYTE offset into the text
 * it received, so the `EXPLAIN AST ` prefix is subtracted.
 */
import {
  CLICKHOUSE_SQL_GRAMMAR,
  findQuestionPlaceholders,
  rewriteQuestionPlaceholders,
} from '../../shared/sql-regions'
import { utf16OffsetFromUtf8, type DbValidation } from './validation'

export const CLICKHOUSE_EXPLAIN_PREFIX = 'EXPLAIN AST '
const SYNTAX_ERROR = '62'
const POSITION = /failed at position (\d+)/

/**
 * `EXPLAIN AST` for `sql`, with each portable `?` rewritten the way the driver binds it
 * (`{pN:…}`); a bare `?` is not ClickHouse syntax and would be a false syntax error.
 */
export function clickHouseExplainText(sql: string): string {
  const count = findQuestionPlaceholders(sql, CLICKHOUSE_SQL_GRAMMAR).length
  const bound = rewriteQuestionPlaceholders(
    sql,
    count,
    CLICKHOUSE_SQL_GRAMMAR,
    (i) => `{p${i}:String}`,
  )
  return `${CLICKHOUSE_EXPLAIN_PREFIX}${bound}`
}

export function clickHouseValidationFromError(sql: string, err: unknown): DbValidation {
  const code = (err as { code?: unknown } | null)?.code
  if (String(code) !== SYNTAX_ERROR) return { ok: true }
  const message = err instanceof Error ? err.message : String(err)
  const position = Number(POSITION.exec(message)?.[1])
  // Positions are only meaningful when nothing was rewritten between `sql` and the server.
  const rewritten = findQuestionPlaceholders(sql, CLICKHOUSE_SQL_GRAMMAR).length > 0
  const byteOffset = position - 1 - Buffer.byteLength(CLICKHOUSE_EXPLAIN_PREFIX)
  const offset =
    !rewritten && Number.isInteger(position) ? utf16OffsetFromUtf8(sql, byteOffset) : undefined
  return {
    ok: false,
    message: message.trim(),
    code: SYNTAX_ERROR,
    ...(offset !== undefined ? { offset } : {}),
  }
}
