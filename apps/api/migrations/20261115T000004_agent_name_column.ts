import { sql, type Kysely } from 'kysely'

// An agent is identified by its Claude Code `name`; the session's display snapshot of it is the
// same word, so its column is called that too.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions RENAME COLUMN agent_handle TO agent_name`.execute(db)
}
