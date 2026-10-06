import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN external_agent_provider TEXT`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN external_agent_session_key TEXT`.execute(db)
}
