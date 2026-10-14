import { sql, type Kysely } from 'kysely'

/**
 * The notification journal: an append-only event log and the inbox projected from it.
 *
 * `notification_events.seq` is the sync cursor every client resumes from; it is an SQLite rowid, so
 * it survives a restart — unlike the stream registry's in-memory ids, which start over each boot.
 * `notification_inbox` holds one row per (user, subject key) and is written in the same transaction
 * as the event that changed it. `notification_op_receipts` makes a client's retried batch (its
 * offline outbox) a no-op.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE notification_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('raised', 'reopened', 'repeated', 'settled', 'read', 'removed')),
      source TEXT NOT NULL CHECK (source IN ('server', 'client')),
      payload_json TEXT DEFAULT '{}' NOT NULL,
      occurred_at TEXT NOT NULL,
      recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
    )
  `.execute(db)
  await sql`CREATE INDEX notification_events_user_seq ON notification_events (user_id, seq)`.execute(
    db,
  )
  await sql`CREATE INDEX notification_events_recorded ON notification_events (recorded_at)`.execute(
    db,
  )

  await sql`
    CREATE TABLE notification_inbox (
      user_id TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      last_seq INTEGER NOT NULL,
      topic TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('human-input', 'agent', 'terminal', 'system')),
      severity TEXT NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'error')),
      title TEXT NOT NULL,
      body TEXT,
      origin_json TEXT NOT NULL,
      session_id TEXT,
      actions_json TEXT,
      trace_json TEXT,
      is_condition INTEGER DEFAULT 0 NOT NULL CHECK (is_condition IN (0, 1)),
      state TEXT DEFAULT 'open' NOT NULL CHECK (state IN ('open', 'settled')),
      settle_reason TEXT,
      occurrence_count INTEGER DEFAULT 1 NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      read_at TEXT,
      settled_at TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, subject_key)
    )
  `.execute(db)
  await sql`CREATE INDEX notification_inbox_user_seq ON notification_inbox (user_id, last_seq)`.execute(
    db,
  )
  await sql`CREATE INDEX notification_inbox_user_session ON notification_inbox (user_id, session_id)`.execute(
    db,
  )
  await sql`CREATE INDEX notification_inbox_user_state ON notification_inbox (user_id, state, last_seen_at)`.execute(
    db,
  )

  await sql`
    CREATE TABLE notification_op_receipts (
      op_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
      PRIMARY KEY (user_id, op_id)
    )
  `.execute(db)
  await sql`CREATE INDEX notification_op_receipts_created ON notification_op_receipts (created_at)`.execute(
    db,
  )
}
