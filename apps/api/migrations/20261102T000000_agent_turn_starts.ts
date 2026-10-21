import { sql, type Kysely } from 'kysely'

// An agent turn ticket is acknowledged before its run starts (at most once: a crash never replays
// tools). The acknowledgement records the reply slot it is about to fill here, in the same
// transaction; the dispatch clears it once the run has returned. A row still present at boot is a
// slot whose run never began: recovery settles its empty placeholder (`wake-queue/turn-starts.ts`).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE agent_turn_starts (
      assistant_message_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `.execute(db)
  await sql`CREATE INDEX agent_turn_starts_session_idx ON agent_turn_starts(session_id)`.execute(db)
}
