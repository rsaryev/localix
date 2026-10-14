/**
 * Pre-run validation of a console text: every top-level statement is compiled by the engine
 * itself (`DbDriver.validate`) and nothing executes.
 *
 * The console's own checks know the cached schema but not the grammar, so `SELEC * FROM
 * users` reached the engine unflagged. Asking the engine answers that, and two rules keep the
 * answer honest:
 *
 *  - a statement is compiled against the CURRENT catalog, so a name an earlier statement of
 *    the same text creates (`CREATE TABLE t …; INSERT INTO t …`) looks unknown. A name-level
 *    ("semantic") failure after an earlier, compiling statement that may define names is
 *    therefore reported as unverified, never as an error the run would not actually hit;
 *  - validation is bounded — per statement by the driver, overall by a budget — and a check
 *    that cannot run in time is "skipped", never an error: it says nothing about the SQL.
 */
import type { ValidateResponse, ValidateStatementResult } from '../contracts'
import type { DbValidation } from '../drivers/port'
import { isReadOnlyStatementForDialect } from '../read-only/sql'
import { executableStatements, type SqlExecutableStatement } from '../../shared/sql-statements'
import { maskSqlNonCode, sqlGrammarForDialect } from '../../shared/sql-regions'
import type { DbDialect } from '../../shared/driver-catalog'
import type { LiveEntry } from './live-entry'

/** Statements compiled per request; the rest of a long script is reported as `limit`. */
export const VALIDATE_STATEMENT_LIMIT = 50
/** Wall-clock budget for one request across all its statements. */
export const VALIDATE_BUDGET_MS = 5_000

/**
 * What to compile: each statement, or — for an engine whose batches carry their own semantics
 * (`nativeScripts`, T-SQL `DECLARE` scope) — the whole text as one unit.
 */
function units(live: LiveEntry, sql: string): SqlExecutableStatement[] {
  const statements = executableStatements(sql, live.flags.dialect)
  if (!live.driver.nativeScripts || statements.length === 0) return statements
  return [{ text: sql.slice(statements[0]!.start).trimEnd(), start: statements[0]!.start }]
}

function toResult(
  unit: SqlExecutableStatement,
  verdict: DbValidation,
  mayDependOnEarlier: boolean,
): ValidateStatementResult {
  const statementStart = unit.start
  if (verdict.ok) {
    return { statementStart, ok: true, ...(verdict.skipped ? { skipped: verdict.skipped } : {}) }
  }
  if (verdict.semantic && mayDependOnEarlier) {
    return { statementStart, ok: true, skipped: 'depends-on-earlier' }
  }
  return {
    statementStart,
    ok: false,
    message: verdict.message,
    ...(verdict.offset !== undefined ? { offset: statementStart + verdict.offset } : {}),
    ...(verdict.code ? { code: verdict.code } : {}),
  }
}

export async function runValidate(
  live: LiveEntry,
  sql: string,
  signal?: AbortSignal,
): Promise<ValidateResponse> {
  // Bound: a driver whose validate reads `this` (its pool, its dialect) must not lose it here.
  const validate = live.driver.validate?.bind(live.driver)
  if (live.flags.kind !== 'sql' || !validate) return { supported: false, results: [] }
  const dialect = live.flags.dialect
  const all = executableStatements(sql, dialect)
  // A native batch is one unit, so "earlier" means "anywhere else in the batch".
  const batchMayDefine =
    all.length > 1 && all.some((statement) => mayDefineNames(statement.text, dialect))
  let earlierMayDefine = false
  const deadline = Date.now() + VALIDATE_BUDGET_MS
  const results: ValidateStatementResult[] = []
  for (const [index, unit] of units(live, sql).entries()) {
    if (index >= VALIDATE_STATEMENT_LIMIT) {
      results.push({ statementStart: unit.start, ok: true, skipped: 'limit' })
      continue
    }
    let verdict: DbValidation
    if (signal?.aborted || live.closing || Date.now() > deadline) {
      verdict = { ok: true, skipped: 'busy' }
    } else {
      // A driver failure is the check failing, not the SQL: no verdict.
      verdict = await validate(unit.text, signal).catch(
        () => ({ ok: true, skipped: 'busy' }) as const,
      )
    }
    const dependsOn = live.driver.nativeScripts ? batchMayDefine : earlierMayDefine
    results.push(toResult(unit, verdict, dependsOn))
    // A statement that does not compile will not run, so it defines nothing either.
    if (verdict.ok && mayDefineNames(unit.text, dialect)) earlierMayDefine = true
  }
  return { supported: true, results }
}

/** Writes that change rows, never the names later statements resolve. */
const ROW_WRITES = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'UPSERT'])

/**
 * Could running this statement change what a LATER statement's names resolve to? A proven
 * read cannot, nor can a plain row write; anything else (DDL, `SET search_path`, `USE`,
 * `ATTACH`, `SELECT … INTO`, an unrecognised statement) is assumed to.
 */
function mayDefineNames(text: string, dialect: DbDialect): boolean {
  if (isReadOnlyStatementForDialect(text, dialect)) return false
  const code = maskSqlNonCode(text, sqlGrammarForDialect(dialect))
  const first = /^[\s(]*([A-Za-z_]+)/.exec(code)?.[1]?.toUpperCase()
  return !first || !ROW_WRITES.has(first)
}
