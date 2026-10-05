/**
 * A multi-statement text, executed statement by statement.
 *
 * Handing a whole script to a driver silently lost statements: bun:sqlite's `prepare`
 * compiles the first statement and ignores the rest (a `CREATE TABLE …; INSERT …` created
 * the table and never inserted, reporting success), and ClickHouse reads the tail of an
 * `INSERT … VALUES` as data. Other engines ran everything but showed only one result
 * (PostgreSQL the first, SQLite the last) or refused the text outright (MySQL, parameterized
 * PostgreSQL). So the service splits with the shared splitter and runs each statement
 * itself — one path, one answer for every engine:
 *
 *  - statements run in order on one session (the open manual transaction when there is
 *    one, else the driver's pinned `session`), and the run STOPS at the first failure,
 *    whose error names the statement and how many ran before it;
 *  - the result is the LAST row-returning statement's, or the summed `rowsAffected` when
 *    none returned rows, plus `{ total, executed }`.
 *
 * An engine whose batches carry their own semantics (`DbDriver.nativeScripts`, T-SQL) keeps
 * receiving the text whole.
 */
import type { DbResultSet, DbStatementRunner } from '../drivers/port'
import { DbError, mapDbError, withStatementFailure } from '../errors'
import { executableStatements, type SqlExecutableStatement } from '../../shared/sql-statements'
import type { QueryStatementCount } from '../contracts'
import type { LiveEntry } from './live-entry'

/**
 * The statements of `sql` when it is a script this service must run one by one, else null
 * (one statement, a non-SQL engine, or an engine with native batches — the text then goes
 * to the driver untouched, exactly as before).
 */
export function scriptStatements(live: LiveEntry, sql: string): SqlExecutableStatement[] | null {
  if (live.flags.kind !== 'sql' || live.driver.nativeScripts) return null
  const statements = executableStatements(sql, live.flags.dialect)
  return statements.length > 1 ? statements : null
}

export interface ScriptOutcome {
  result: DbResultSet
  statements: QueryStatementCount
}

export async function runScript(
  statements: SqlExecutableStatement[],
  run: DbStatementRunner,
  signal: AbortSignal,
): Promise<ScriptOutcome> {
  const total = statements.length
  const results: DbResultSet[] = []
  for (const [index, statement] of statements.entries()) {
    const failure = { index, total, executed: index, start: statement.start }
    // A Stop between statements must not start the next one: a driver that ignores its
    // signal (bun:sqlite is synchronous) would otherwise apply it before we notice.
    if (signal.aborted) throw withStatementFailure(new DbError('cancelled'), failure)
    try {
      results.push(await run(statement.text, undefined, signal))
    } catch (err) {
      throw withStatementFailure(mapDbError(err), failure)
    }
  }
  return { result: combineResults(results), statements: { total, executed: total } }
}

/** The last row-returning result, else one result carrying the summed write counts. */
export function combineResults(results: DbResultSet[]): DbResultSet {
  const durationMs = results.reduce((sum, result) => sum + result.durationMs, 0)
  const withRows = results.findLast((result) => result.columns.length > 0)
  if (withRows) return { ...withRows, durationMs }
  const counts = results.flatMap((result) =>
    typeof result.rowsAffected === 'number' ? [result.rowsAffected] : [],
  )
  const lastInsertId = results.findLast((result) => result.lastInsertId !== undefined)?.lastInsertId
  return {
    columns: [],
    rows: [],
    ...(counts.length ? { rowsAffected: counts.reduce((sum, n) => sum + n, 0) } : {}),
    ...(lastInsertId !== undefined ? { lastInsertId } : {}),
    durationMs,
  }
}
