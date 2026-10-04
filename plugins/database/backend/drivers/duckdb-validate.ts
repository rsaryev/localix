/**
 * DuckDB's compile-only check: `DuckDBConnection.prepare()` then destroy, never execute.
 *
 * Preparing parses, binds and plans the statement (C API `duckdb_prepare`, "Create a
 * prepared statement object from a query") — so it reports a syntax error AND an unknown
 * table/column — and runs nothing (verified: a prepared `DROP TABLE`, `CREATE TABLE`,
 * `INSERT`, `COPY … TO` or `ATTACH` leaves the database unchanged). Binding does READ: a
 * `read_csv(…)` opens its file to sniff the schema, which is why the check is time-bounded.
 *
 * DuckDB's errors carry no structured position in the Node API; the message ends with the
 * offending line and a caret (`LINE 3: WHERE x SELEC` / `        ^`). The caret is trusted
 * only when that echoed line is the statement's real line (DuckDB elides long lines with
 * `...`) and everything before the caret is ASCII (DuckDB renders the caret by byte).
 */
import type { DbValidation } from './validation'

const CARET_TAIL = /\n\nLINE (\d+): ([^\n]*)\n( *)\^\s*$/

function caretOffset(sql: string, message: string): number | undefined {
  const match = CARET_TAIL.exec(message)
  if (!match) return undefined
  const lineNumber = Number(match[1])
  const echoed = match[2]!
  const column = match[3]!.length - `LINE ${match[1]}: `.length
  const lines = sql.split('\n')
  const line = lines[lineNumber - 1]
  if (line === undefined || line !== echoed || column < 0 || column > line.length) return undefined
  // Everything before the caret must be ASCII for the byte column to be a character column.
  if (!/^[\x20-\x7e\t]*$/.test(line.slice(0, column))) return undefined
  const lineStart = lines.slice(0, lineNumber - 1).reduce((sum, text) => sum + text.length + 1, 0)
  return lineStart + column
}

export function duckDbValidationFromError(sql: string, err: unknown): DbValidation {
  const raw = err instanceof Error ? err.message : String(err)
  const offset = caretOffset(sql, raw)
  // `Parser Error: …` is the grammar; every other class (Binder, Catalog, IO …) ran after it.
  const errorClass = /^([A-Za-z ]+) Error:/.exec(raw)?.[1]
  return {
    ok: false,
    message: raw.replace(CARET_TAIL, '').trim(),
    ...(offset !== undefined ? { offset } : {}),
    ...(errorClass ? { code: `${errorClass} Error` } : {}),
    ...(errorClass === 'Parser' ? {} : { semantic: true }),
  }
}

/** The slice of a DuckDB connection the check needs (structural, for tests). */
export interface DuckDbPreparer {
  prepare(sql: string): Promise<{ destroySync(): void }>
}

export async function compileDuckDbStatement(
  connection: DuckDbPreparer,
  sql: string,
): Promise<DbValidation> {
  try {
    ;(await connection.prepare(sql)).destroySync()
    return { ok: true }
  } catch (err) {
    return duckDbValidationFromError(sql, err)
  }
}
