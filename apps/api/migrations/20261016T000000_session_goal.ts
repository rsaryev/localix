import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN goal TEXT`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN previous_topic_summary TEXT`.execute(db)
}
