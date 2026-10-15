import { sql, type Kysely } from 'kysely'

/** Participants can always change; the per-session lock on them is gone. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions DROP COLUMN roster_locked`.execute(db)
}
