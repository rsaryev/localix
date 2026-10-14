import { sql, type Kysely } from 'kysely'

/** Roster reads must scale with conversations, rather than the entire transcript history. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0)`.execute(db)
  await sql`UPDATE agent_sessions SET message_count = (
    SELECT count(*) FROM agent_messages WHERE session_id = agent_sessions.id
  )`.execute(db)
  await sql`CREATE TRIGGER agent_messages_count_insert AFTER INSERT ON agent_messages BEGIN
    UPDATE agent_sessions SET message_count = message_count + 1 WHERE id = new.session_id;
  END`.execute(db)
  await sql`CREATE TRIGGER agent_messages_count_delete AFTER DELETE ON agent_messages BEGIN
    UPDATE agent_sessions SET message_count = message_count - 1 WHERE id = old.session_id;
  END`.execute(db)
  await sql`CREATE TRIGGER agent_messages_count_move AFTER UPDATE OF session_id ON agent_messages
    WHEN old.session_id <> new.session_id BEGIN
    UPDATE agent_sessions SET message_count = message_count - 1 WHERE id = old.session_id;
    UPDATE agent_sessions SET message_count = message_count + 1 WHERE id = new.session_id;
  END`.execute(db)
  await sql`CREATE INDEX agent_sessions_user_project_updated_idx
    ON agent_sessions(user_id, project_id, updated_at DESC)`.execute(db)
}
