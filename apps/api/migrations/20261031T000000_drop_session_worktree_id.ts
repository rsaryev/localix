import { sql, type Kysely } from 'kysely'

/** Nothing reads or writes `agent_sessions.worktree_session_id`; the column goes. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions DROP COLUMN worktree_session_id`.execute(db)
}
