import { sql, type Kysely } from 'kysely'

// A delegated child its delegator CLOSED (`agents close`): nothing wakes it again — not its
// delegator, not the person, not a queued wake. Null = open.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN closed_at TEXT`.execute(db)
}
