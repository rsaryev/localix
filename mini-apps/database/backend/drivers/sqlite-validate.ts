/**
 * SQLite's compile-only check: `sqlite3_prepare_v3` then finalize, never `sqlite3_step`.
 *
 * Preparing compiles the statement into bytecode against the CURRENT schema — so it reports
 * a syntax error AND an unknown table/column/function — and executes nothing: per
 * https://sqlite.org/c3ref/prepare.html the statement only runs when stepped, and a DDL
 * statement only changes the schema when it runs (verified: a prepared-and-finalized
 * `DROP TABLE` leaves the table in place).
 *
 * bun:sqlite exposes the engine's `sqlite3_error_offset()` as `byteOffset` (a UTF-8 byte
 * offset, -1 when unknown); it is converted to the editor's UTF-16 offset here.
 */
import type { Database } from 'bun:sqlite'
import { utf16OffsetFromUtf8, type DbValidation } from './validation'

/**
 * Messages the SQLite tokenizer and parser raise (`parse.y`, `tokenize.c`). Anything else is
 * raised after parsing, while resolving names — a "semantic" failure a preceding statement of
 * the same script may cure.
 */
const PARSE_FAILURE = /syntax error|incomplete input|unrecognized token/i

export function sqliteValidationFromError(sql: string, err: unknown): DbValidation {
  const message = err instanceof Error ? err.message : String(err)
  const detail = err as { byteOffset?: unknown; errno?: unknown; code?: unknown } | null
  const byteOffset = typeof detail?.byteOffset === 'number' ? detail.byteOffset : -1
  const offset = byteOffset >= 0 ? utf16OffsetFromUtf8(sql, byteOffset) : undefined
  const code =
    typeof detail?.code === 'string'
      ? detail.code
      : typeof detail?.errno === 'number'
        ? String(detail.errno)
        : undefined
  return {
    ok: false,
    message,
    ...(offset !== undefined ? { offset } : {}),
    ...(code ? { code } : {}),
    ...(PARSE_FAILURE.test(message) ? {} : { semantic: true }),
  }
}

/** Compile `sql` on `db` and throw the bytecode away. The caller holds the connection lease. */
export function compileSqliteStatement(db: Database, sql: string): DbValidation {
  try {
    db.prepare(sql).finalize()
    return { ok: true }
  } catch (err) {
    return sqliteValidationFromError(sql, err)
  }
}
