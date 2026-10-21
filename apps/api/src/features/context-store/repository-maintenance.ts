import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { COMPRESS_MIN_BYTES, encodeArtifactText } from './artifact-codec'

// Housekeeping for what the context store keeps. Both passes are safe to repeat and to stop
// half-way: each unit of work is one small transaction, and a unit that was already done is
// skipped by its own predicate rather than by a marker.

const BATCH = 25

/**
 * Compress the tool outputs written before outputs were compressed. Rows are taken in small
 * batches, largest first, so a pass that is cut short has already converted the rows that matter
 * and never holds the writer for longer than one batch. `yieldToLoop` is the idle scheduler's
 * `ctx.yield`, called between batches. Resolves to the number of rows converted and the bytes
 * their text no longer occupies.
 */
export async function compactArtifacts(
  db: Kysely<AppDatabase>,
  options: { yieldToLoop?: () => Promise<void>; aborted?: () => boolean } = {},
): Promise<{ rows: number; savedBytes: number }> {
  let rows = 0
  let savedBytes = 0
  // Rows that stayed plain after an attempt (they do not compress) must not be selected again.
  const skip = new Set<string>()
  for (;;) {
    if (options.aborted?.()) break
    const batch = await db
      .selectFrom('tool_output_artifacts')
      .select(['user_id', 'session_id', 'tool_call_id', 'content', 'byte_length'])
      .where('encoding', '=', 'plain')
      .where('byte_length', '>=', COMPRESS_MIN_BYTES)
      .orderBy('byte_length', 'desc')
      .limit(BATCH + skip.size)
      .execute()
    const todo = batch.filter((row) => !skip.has(key(row))).slice(0, BATCH)
    if (todo.length === 0) break
    await db.transaction().execute(async (trx) => {
      for (const row of todo) {
        const stored = encodeArtifactText(row.content)
        if (stored.encoding !== 'zstd') {
          skip.add(key(row))
          continue
        }
        await trx
          .updateTable('tool_output_artifacts')
          .set({ content: '', encoding: 'zstd', content_z: stored.content_z })
          .where('user_id', '=', row.user_id)
          .where('session_id', '=', row.session_id)
          .where('tool_call_id', '=', row.tool_call_id)
          .where('encoding', '=', 'plain')
          .execute()
        rows += 1
        savedBytes += stored.byteLength - stored.content_z.length
      }
    })
    await options.yieldToLoop?.()
  }
  return { rows, savedBytes }
}

const key = (row: { user_id: string; session_id: string; tool_call_id: string }) =>
  `${row.user_id}\u0000${row.session_id}\u0000${row.tool_call_id}`

/**
 * Remove search sections whose session no longer exists. The search index is a virtual table, so
 * a foreign key cannot cascade into it, and deleting a session used to leave every section its
 * tool outputs had indexed behind for good. Resolves to the number of sections removed.
 */
export async function sweepOrphanChunks(db: Kysely<AppDatabase>): Promise<number> {
  // Counted first: the change count of a DELETE on a virtual table also counts the index's own
  // shadow rows, which is not the number of sections removed.
  const { rows } = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM tool_output_chunks
    WHERE session_id NOT IN (SELECT id FROM agent_sessions)
  `.execute(db)
  const orphans = Number(rows[0]?.n ?? 0)
  if (orphans > 0) {
    await sql`
      DELETE FROM tool_output_chunks
      WHERE session_id NOT IN (SELECT id FROM agent_sessions)
    `.execute(db)
  }
  return orphans
}

/** Remove the search sections of these sessions, inside the transaction that deletes them. */
export async function deleteSessionChunks(
  db: Kysely<AppDatabase>,
  userId: string,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return
  await sql`
    DELETE FROM tool_output_chunks
    WHERE user_id = ${userId} AND session_id IN (${sql.join(sessionIds)})
  `.execute(db)
}
