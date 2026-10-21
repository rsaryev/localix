import { sql, type Kysely } from 'kysely'

// A wake a trigger, a plugin or a background job asked for, kept until the session's durable queue
// admits it: the queue's admission deletes the row in its own transaction, so a crash between the
// producer and the queue redelivers the wake at boot instead of losing it
// (`features/triggers/wake-outbox-repository.ts`).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE wake_outbox (
      delivery_key TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `.execute(db)
  await sql`CREATE INDEX wake_outbox_created_idx ON wake_outbox(created_at)`.execute(db)
}
