/**
 * PostgreSQL's compile-only check: the extended protocol's Parse + Describe, never Execute.
 *
 * postgres.js `.describe()` sends Parse/Describe/Sync for the text (protocol docs, "Extended
 * Query": a Parse message creates a prepared statement; nothing runs until Bind + Execute).
 * The server parses EVERY statement kind this way, and for the optimizable kinds (SELECT,
 * INSERT, UPDATE, DELETE, MERGE, VALUES, TABLE) also runs parse analysis, so an unknown
 * relation or column is reported. A utility statement (DDL, VACUUM, SET …) is only
 * raw-parsed: a syntax error is caught, a name is not — and nothing executes (verified: a
 * described `DROP TABLE` / `CREATE TABLE` leaves the catalog unchanged). This is wider and
 * safer than `PREPARE … AS`, which accepts only the optimizable kinds.
 *
 * Two hazards shape where it runs:
 *  - an error inside a transaction block ABORTS that transaction (25P02 for every later
 *    statement), so the check never touches the user's connection — it uses its own
 *    one-connection client, outside any manual transaction;
 *  - postgres.js names and caches every statement it prepares by default, so describing
 *    keystroke variants would pile up server-side prepared statements. The check's client
 *    is created with `prepare: false`, which sends the unnamed statement instead.
 *
 * The server's `position` is a 1-based CHARACTER (code point) index into the text.
 */
import { utf16OffsetFromCodePoints, type DbValidation } from './validation'

/** The slice of a postgres.js client the check needs (structural, for tests). */
export interface PgDescriber {
  unsafe(text: string): { describe(): PromiseLike<unknown> & { cancel?: () => unknown } }
}

/** SQLSTATE 42601 is the grammar; the other class-42 codes are name/type resolution. */
const PG_SYNTAX_ERROR = '42601'

function isServerError(err: unknown): err is { code: string; message: string; position?: unknown } {
  const candidate = err as { code?: unknown; severity?: unknown } | null
  return (
    typeof candidate?.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(candidate.code) &&
    candidate.severity !== undefined
  )
}

/**
 * The server's verdict on a failed Parse, or `null` when the failure was not the server's
 * judgement of the SQL (connection refused, timeout) and therefore says nothing about it.
 */
export function pgValidationFromError(sql: string, err: unknown): DbValidation | null {
  if (!isServerError(err)) return null
  const position = Number(err.position)
  const offset =
    Number.isInteger(position) && position > 0
      ? utf16OffsetFromCodePoints(sql, position - 1)
      : undefined
  return {
    ok: false,
    message: err.message,
    code: err.code,
    ...(offset !== undefined ? { offset } : {}),
    ...(err.code === PG_SYNTAX_ERROR ? {} : { semantic: true }),
  }
}

export async function compilePgStatement(
  client: PgDescriber,
  sql: string,
  signal: AbortSignal,
): Promise<DbValidation> {
  const pending = client.unsafe(sql).describe()
  const onAbort = () => {
    pending.cancel?.()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await pending
    return { ok: true }
  } catch (err) {
    return pgValidationFromError(sql, err) ?? { ok: true, skipped: 'busy' }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
