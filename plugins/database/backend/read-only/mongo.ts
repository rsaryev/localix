/**
 * Pure MongoDB read/write classifier for the read-only connection guard-rail.
 *
 * The console only accepts `db.<collection>.<method>(<args>)` and only supports six
 * methods ({@link ../drivers/mongo-query.MONGO_METHODS}), all of which READ — so a naive
 * classifier could return `true` for every parseable command. It must not, because
 * `aggregate` can write: an `$out` or `$merge` stage materializes its pipeline into a
 * collection. That is the same "a read starter still hides a write" case the SQL
 * classifier handles for `WITH … DELETE` / `SELECT … INTO`, and it is the only way to
 * mutate data through this console's grammar.
 *
 * Same fail-safe contract as the SQL classifier: anything not PROVEN to be a pure read
 * returns `false`.
 */

import { parseMongoCommand } from '../drivers/mongo-query'

/** Aggregation stages that write their output to a collection. */
const WRITE_STAGES = ['$out', '$merge']

function carriesWriteStage(pipeline: unknown): boolean {
  if (!Array.isArray(pipeline)) return false
  return pipeline.some(
    (stage) =>
      stage !== null &&
      typeof stage === 'object' &&
      !Array.isArray(stage) &&
      Object.keys(stage).some((key) => WRITE_STAGES.includes(key)),
  )
}

/**
 * True only if `command` is PROVEN to be a pure Mongo read. An unparseable command, an
 * unsupported method, or an aggregation carrying a writing stage → `false`.
 */
export function isReadOnlyMongoCommand(command: string): boolean {
  let parsed: ReturnType<typeof parseMongoCommand>
  try {
    parsed = parseMongoCommand(command)
  } catch {
    // Unparseable: we cannot prove it reads, so we refuse. The driver would reject it
    // anyway — this just refuses it earlier and for the safer reason.
    return false
  }
  // `parseMongoCommand` already rejects an unsupported method, so a parsed command is one
  // of the six — every one a read except for `aggregate`'s writing stages.
  if (parsed.method !== 'aggregate') return true
  // `$out`/`$merge` write only when they are stage keys. A literal nested object or an options
  // document carrying the same text is data, not an executable pipeline stage.
  return !carriesWriteStage(parsed.args[0])
}
