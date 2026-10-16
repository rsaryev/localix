import { sql, type Kysely } from 'kysely'

/**
 * The task board is a plugin now, and core keeps no trace of it.
 *
 * The board lives in each chat's own plugin folder (the bundled task-board plugin), so its table, the
 * allocator row behind its `LX-<seq>` ids and the index over the card a delegation came from
 * all describe a feature core no longer has. A delegation carries its brief, not a card id, so
 * the `kanbanTaskId` key goes from every stored delegation's provenance too — the strict
 * provenance parser would otherwise refuse those sessions as written by a bug.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX agent_sessions_task_attempt_idx`.execute(db)
  await sql`DROP TABLE kanban_tasks`.execute(db)
  await sql`DELETE FROM ref_sequence_counters WHERE scope = 'kanban_tasks'`.execute(db)
  await sql`
    UPDATE agent_sessions
    SET invocation_json = json_remove(invocation_json, '$.kanbanTaskId')
    WHERE json_extract(invocation_json, '$.kind') = 'task-delegation'
  `.execute(db)
}
