/**
 * Read-only classification, by engine family — the registry behind the read-only
 * connection guard-rail.
 *
 * Each engine speaks its own language, so each gets its own pure classifier; this module
 * is the one place that maps an {@link EngineKind} to one. Callers ask
 * {@link isReadOnlyInput} and never branch on engine themselves — the guard in
 * `service/run-query.ts` used to gate on `kind === 'sql'`, which silently let every
 * non-SQL engine through on a connection the user had marked read-only.
 *
 * The contract every classifier shares: answer "is this input DEFINITELY only reading?"
 * and fail safe — anything unproven is a write. A missing registry entry therefore blocks
 * rather than permits, so adding an engine to `EngineKind` without a classifier is a
 * refusal (loud, reported to the user), never a hole.
 *
 * This is NOT a security boundary, for the same reason `sql.ts` says so: real isolation
 * comes from connecting with a database user that lacks write privileges. It stops
 * accidental writes on a connection the user marked read-only.
 */

import type { EngineKind } from '../drivers/port'
import { isReadOnlyEsCommand } from './es'
import { isReadOnlyMongoCommand } from './mongo'
import { isReadOnlyRedisCommand } from './redis'
import { isReadOnlyStatement } from './sql'
import { isSideEffectFreeStatement } from './sql-calls'

/** One classifier per engine family. */
const CLASSIFIERS: Record<EngineKind, (input: string) => boolean> = {
  sql: isReadOnlyStatement,
  kv: isReadOnlyRedisCommand,
  document: isReadOnlyMongoCommand,
  search: isReadOnlyEsCommand,
}

/**
 * True only if `input` is PROVEN to be a pure read in `kind`'s language. Unknown engine
 * family → `false` (fail safe).
 */
export function isReadOnlyInput(kind: EngineKind, input: string): boolean {
  return CLASSIFIERS[kind]?.(input) ?? false
}

/**
 * Redis read verbs that are ALSO a SQL statement verb that writes: Postgres's
 * `CLUSTER info` physically rewrites the table `info`, so the Redis reading of
 * `CLUSTER INFO` cannot vouch for the text when the engine is unknown. (`DUMP` was
 * Sybase/old T-SQL's spelling of BACKUP.) The cost is a confirmation on those Redis reads.
 */
const REDIS_VERBS_THAT_WRITE_IN_SQL = new Set(['CLUSTER', 'DUMP'])

/**
 * "Is this input a read on WHICHEVER engine runs it?" — for the permission path, which
 * sees only the tool input: `connection_id` is a name it cannot resolve to an engine
 * without I/O, and a tool's `classify` is pure and synchronous.
 *
 * The defect it replaces: the tool classified every `query` with the SQL classifier, so
 * `GET user:1`, `db.users.find({})` and `products.search({…})` were all "writes" and a
 * read-only session refused every Redis, MongoDB and Elasticsearch read.
 *
 * Why a UNION of the per-engine verdicts is sound: the four languages do not overlap in a
 * way that turns one engine's proven read into another engine's write.
 *   - a Mongo read is `[db.]<coll>.<method>(…)` and an Elasticsearch read is
 *     `<index>.<method>(…)`, each over a fixed set of reading methods: no SQL statement
 *     starts with a dotted name, and Redis has no command word containing a `.`;
 *   - a SQL read starts with SELECT/WITH/EXPLAIN/SHOW/PRAGMA/DESCRIBE/DESC/VALUES/TABLE:
 *     neither the Mongo nor the ES parser accepts it, and of those only `SELECT` is a Redis
 *     command, which switches the logical database and writes nothing;
 *   - a Redis read verb is not a SQL write — except the ones listed above, refused here.
 * A text no classifier proves a read is a write, as everywhere in this module. The SQL
 * reading is the STRICT one (`sql-calls.ts`), which also refuses unknown function calls.
 */
export function isReadOnlyForUnknownEngine(input: string): boolean {
  if (isSideEffectFreeStatement(input)) return true
  if (isReadOnlyMongoCommand(input) || isReadOnlyEsCommand(input)) return true
  const verb = input.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? ''
  return !REDIS_VERBS_THAT_WRITE_IN_SQL.has(verb) && isReadOnlyRedisCommand(input)
}
