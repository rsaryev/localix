import { sql, type Kysely } from 'kysely'

/**
 * Queued questions (`ask` with `wait: false`) are gone: every `ask` now blocks until the person
 * answers or the five-minute deadline passes, so nothing is left to answer later. Its indexes go
 * with the table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "agent_questions"`.execute(db)
}
