import { sql, type Kysely } from 'kysely'

// A queued delivery that failed every retry leaves the head of its session's queue instead of
// blocking it forever: its rows move to state 'failed' with the last error here, stay visible in
// the queue snapshot, and wait for the person to retry or remove them (`wake-queue/dead-letter.ts`).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_queue_items ADD COLUMN failure TEXT`.execute(db)
}
