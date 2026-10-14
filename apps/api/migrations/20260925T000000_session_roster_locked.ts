import { sql, type Kysely } from 'kysely'

// A conversation whose participants the person fixed before it started: nobody — the person,
// an agent's `conversation_control`, a board assignment — changes who is in it afterwards.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN roster_locked INTEGER NOT NULL DEFAULT 0`.execute(
    db,
  )
}
