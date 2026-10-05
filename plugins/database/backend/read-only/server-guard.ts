import type { DbDialect } from '../../shared/driver-catalog'

/**
 * Server-enforced read-only, for the engines that can do it.
 *
 * A connection the user marked read-only was guarded ONLY by the text classifier in
 * `../read-only` — whose own header says "It is NOT a security boundary … it exists to stop
 * *accidental* writes" — while `run-query.ts` calls that check the "primary enforcement
 * point". Pattern matching cannot decide this: `SELECT nextval('s')`,
 * `SELECT setval(...)`, `SELECT lo_unlink(1)` and any volatile UDF are writes wearing a
 * SELECT, because `WRITE_KEYWORDS` can catch `CALL`/`EXECUTE` but not a function call.
 *
 * The robust answer is to ask the SERVER instead of parsing: a session- or
 * connection-scoped read-only setting, in whatever form the dialect spells it below.
 *
 * So this is a DEFENCE LAYER, not a replacement: the classifier still runs first because it
 * produces a good error before a round-trip, and it covers the engines below that have no
 * server-side switch at all.
 *
 * Deliberately NOT claimed: this is not total either. A read-only transaction does not stop
 * `pg_terminate_backend` (it writes nothing), and `dblink_exec` opens its OWN connection so
 * it escapes the setting entirely. It does stop the whole INSERT/UPDATE/DELETE/DDL family
 * plus sequence and large-object writes, which is the class the text classifier misses.
 */
export const SERVER_READ_ONLY_STATEMENT: Partial<Record<DbDialect, string>> = {
  // Session-scoped so it survives every later statement on this connection, unlike a
  // per-transaction `SET TRANSACTION READ ONLY` that a bare statement would not enter.
  postgres: 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY',
  mysql: 'SET SESSION TRANSACTION READ ONLY',
  // SQLite's actual equivalent — it makes the connection reject any write, including one
  // from a trigger, and unlike opening the file read-only it needs no path juggling.
  sqlite: 'PRAGMA query_only = 1',
}

/**
 * Engines with NO server-side read-only switch, listed rather than left implicit so the
 * gap is auditable:
 *   - `mssql` has no session equivalent (`ApplicationIntent=ReadOnly` targets a replica,
 *     which is a different guarantee and needs a replica to exist)
 *   - `clickhouse`'s `readonly` setting is a user/profile property, not a session one a
 *     client may set on itself
 *   - `redis`, `mongodb`, `elasticsearch` have no transaction concept to make read-only
 * For these the text classifier remains the only guard, and `applyServerReadOnly` reports
 * that honestly instead of returning a success the engine never gave.
 */
export const NO_SERVER_READ_ONLY: readonly DbDialect[] = [
  'mssql',
  'clickhouse',
  'redis',
  'mongodb',
  'elasticsearch',
]

export type ServerReadOnlyOutcome =
  /** The engine accepted the switch — writes now fail at the server. */
  | { enforced: true }
  /** The engine has no such switch; the classifier is the only guard. */
  | { enforced: false; reason: 'unsupported' }
  /** The engine has one and REJECTED it (permissions, a proxy, an old version). */
  | { enforced: false; reason: 'rejected'; error: string }

/**
 * Ask the connection to enforce read-only itself. Called once, right after the connect
 * probe, only for a connection the user marked read-only.
 *
 * A rejection does NOT fail the connection: that would turn "your server would not take a
 * hint" into "you cannot connect at all", and the classifier still guards the path exactly
 * as it did before this layer existed. The outcome is returned so the caller can surface it
 * — silently downgrading a security posture is the failure mode worth avoiding here.
 */
export async function applyServerReadOnly(
  dialect: DbDialect,
  run: (sql: string) => Promise<unknown>,
): Promise<ServerReadOnlyOutcome> {
  const statement = SERVER_READ_ONLY_STATEMENT[dialect]
  if (!statement) return { enforced: false, reason: 'unsupported' }
  try {
    await run(statement)
    return { enforced: true }
  } catch (err) {
    return {
      enforced: false,
      reason: 'rejected',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
