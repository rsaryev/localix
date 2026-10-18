import { sql, type Kysely } from 'kysely'

// The change feed (`features/changes`): one notice per change, which each consumer reads at its
// own cursor. Semantic search now reads it instead of its own triggers, and an item may name a
// parent (a message its chat) so a parent's deletion removes its children's vectors.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE change_events (
      seq integer primary key autoincrement,
      stream text not null,
      entity text not null,
      op text not null check (op in ('upserted', 'deleted', 'resync')),
      ref_json text,
      recorded_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')) not null
    )
  `.execute(db)
  await sql`CREATE INDEX change_events_by_stream ON change_events (stream, seq)`.execute(db)
  await sql`
    CREATE TABLE change_cursors (
      consumer text not null,
      stream text not null,
      seq integer not null,
      updated_at text not null,
      primary key (consumer, stream)
    )
  `.execute(db)

  await sql`ALTER TABLE semantic_items ADD COLUMN parent text`.execute(db)
  await sql`CREATE INDEX semantic_items_by_parent ON semantic_items (collection, parent)`.execute(db)

  for (const name of [
    'messages_insert',
    'messages_text',
    'messages_delete',
    'sessions_insert',
    'sessions_title',
    'sessions_delete',
  ]) {
    await sql.raw(`DROP TRIGGER IF EXISTS semantic_outbox_${name}`).execute(db)
  }
}
