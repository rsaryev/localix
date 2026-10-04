import { sql, type Kysely } from 'kysely'

/**
 * Deterministic context checkpoints replace LLM compaction.
 *
 * `agent_message_model_context` holds what a run needs to rebuild the MODEL's view of a
 * conversation, keyed by the assistant row of the run that produced it: that turn's runtime
 * context (a snapshot or the sections that changed) and, when the run took one, the checkpoint
 * that froze the view. It is a table of its own rather than fields on the message because the
 * transcript is shipped to every client and this state is the model's alone.
 *
 * The data half removes what the old mechanism left behind. A compaction boundary row with a
 * summary, read by the new code, would look like a `/clear` and silently drop the history before
 * it, so those rows go — their children re-parented, the leaf moved — together with the
 * "context compacted" notices, any queued `/compact` barrier and the summarizer's model route.
 * `/clear` boundaries stay.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE agent_message_model_context (
      message_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      turn_context_json TEXT,
      checkpoint_json TEXT,
      updated_at TEXT NOT NULL
    )
  `.execute(db)
  await sql`CREATE INDEX agent_message_model_context_session_idx ON agent_message_model_context (session_id)`.execute(
    db,
  )

  const doomed = await sql<{ id: string; session_id: string; parent_id: string | null }>`
    SELECT id, session_id, parent_id FROM agent_messages
    WHERE json_extract(payload_json, '$.compactedUpToId') IS NOT NULL
       OR json_extract(payload_json, '$.contextSummary') IS NOT NULL
       OR json_extract(payload_json, '$.systemNotice.kind') = 'context_compacted'
  `.execute(db)
  // A summary is usually followed by its own "context compacted" notice, so doomed rows chain.
  // Re-parenting to the parent as first read would hang a child on a row deleted a step later;
  // each one is re-parented to its nearest SURVIVING ancestor instead.
  const parentOf = new Map(doomed.rows.map((row) => [row.id, row.parent_id]))
  const survivor = (id: string | null): string | null => {
    let current = id
    while (current !== null && parentOf.has(current)) current = parentOf.get(current) ?? null
    return current
  }
  for (const row of doomed.rows) {
    const parent = survivor(row.parent_id)
    await sql`UPDATE agent_messages SET parent_id = ${parent} WHERE parent_id = ${row.id}`.execute(
      db,
    )
    await sql`UPDATE agent_sessions SET leaf_id = ${parent} WHERE leaf_id = ${row.id}`.execute(db)
    await sql`DELETE FROM agent_messages WHERE id = ${row.id}`.execute(db)
  }
  await sql`DELETE FROM agent_queue_items WHERE kind = 'compact'`.execute(db)
  // The summarizer's model route has no workload any more. Left in place it would fail the
  // settings schema, which accepts routes only for workloads that exist, and the whole settings
  // blob would stop validating over one dead key.
  await sql`
    UPDATE user_profiles
    SET agent_settings = json_remove(agent_settings, '$.modelRouting.compression')
    WHERE json_valid(agent_settings)
      AND json_type(agent_settings, '$.modelRouting.compression') IS NOT NULL
  `.execute(db)
}
