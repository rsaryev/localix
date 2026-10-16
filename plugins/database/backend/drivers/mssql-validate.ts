/**
 * SQL Server's compile-only check: `sys.dm_exec_describe_first_result_set(@tsql, NULL, 0)`.
 *
 * The batch travels as a PARAMETER to a catalog function that analyzes it and returns its
 * errors as rows (docs: "sys.dm_exec_describe_first_result_set", columns `error_number`,
 * `error_message`). Nothing in the batch executes and no session option changes.
 *
 * The session-option alternatives were measured and rejected:
 *  - `SET PARSEONLY ON; <batch>; SET PARSEONLY OFF` in one request EXECUTED the batch —
 *    a `DELETE FROM u` inside it deleted every row. PARSEONLY is a parse-time option that
 *    only works as its own batch, and the pool resets the connection between requests;
 *  - `SET NOEXEC ON; <batch>` does suppress execution, but a `SET NOEXEC OFF` inside the
 *    user's text would switch execution back on for everything after it.
 *
 * What it reports: syntax errors anywhere in the batch, and unknown objects/columns in the
 * statements it analyzes (it stops at the first result set). It cannot compile a batch
 * whose first statement must stand alone (`CREATE PROCEDURE/FUNCTION/VIEW/TRIGGER`), which
 * is reported as `unsupported`, and T-SQL errors carry a line but no column, so there is no
 * offset. Requires SQL Server 2012+.
 */
import {
  findQuestionPlaceholders,
  maskSqlNonCode,
  MSSQL_SQL_GRAMMAR,
  rewriteQuestionPlaceholders,
} from '../../shared/sql-regions'
import type { DbValidation } from './validation'

export const MSSQL_DESCRIBE_QUERY =
  'SELECT error_number, error_message FROM sys.dm_exec_describe_first_result_set(@tsql, NULL, 0) WHERE error_number IS NOT NULL'

/** Summary rows ("the batch could not be analyzed …") that follow the real error. */
const SUMMARY_ERRORS = new Set([11501, 11529])
/** Parser error numbers; every other number is raised while binding names and types. */
const SYNTAX_ERRORS = new Set([102, 103, 105, 156, 170, 319, 1038])
/** Batches whose first statement must be alone in its batch — the DMF wraps them. */
const STANDALONE_DDL =
  /^\s*(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROC|PROCEDURE|FUNCTION|VIEW|TRIGGER)\b/i

/**
 * The batch as the driver would send it: each code-level `?` becomes the adapter's
 * `@__localix_pN` name (see `bindMssqlParams`), which the DMF accepts undeclared.
 */
export function mssqlDescribeText(sql: string): string {
  const count = findQuestionPlaceholders(sql, MSSQL_SQL_GRAMMAR).length
  return rewriteQuestionPlaceholders(sql, count, MSSQL_SQL_GRAMMAR, (i) => `@__localix_p${i}`)
}

export function isStandaloneMssqlDdl(sql: string): boolean {
  return STANDALONE_DDL.test(maskSqlNonCode(sql, MSSQL_SQL_GRAMMAR))
}

export function mssqlValidationFromRows(
  rows: Array<{ error_number: number | null; error_message: string | null }>,
): DbValidation {
  const error = rows.find(
    (row) => row.error_number !== null && !SUMMARY_ERRORS.has(row.error_number),
  )
  if (!error) return { ok: true }
  const number = error.error_number!
  return {
    ok: false,
    message: error.error_message ?? `SQL Server error ${number}`,
    code: String(number),
    ...(SYNTAX_ERRORS.has(number) ? {} : { semantic: true }),
  }
}
