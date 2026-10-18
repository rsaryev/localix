import { sql, type Kysely } from 'kysely'

const ENABLED = `EXISTS (SELECT 1 FROM semantic_settings WHERE id = 1 AND enabled = 1)`

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE semantic_settings (
      id integer primary key check (id = 1),
      enabled integer not null default 0,
      model_id text,
      updated_at text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE semantic_collections (
      name text primary key not null,
      fingerprint text not null,
      source_version integer not null,
      backfill_cursor text,
      backfill_done integer not null default 0,
      updated_at text not null
    )
  `.execute(db)
  await sql`
    CREATE TABLE semantic_items (
      id integer primary key autoincrement,
      collection text not null,
      item_key text not null,
      chunk integer not null,
      user_id text not null,
      scope text,
      content_hash text not null,
      excerpt text not null,
      vector blob not null,
      created_at text not null,
      constraint semantic_items_key_unique unique (collection, item_key, chunk)
    )
  `.execute(db)
  await sql`CREATE INDEX semantic_items_by_owner ON semantic_items (collection, user_id)`.execute(db)
  await sql`
    CREATE TABLE semantic_outbox (
      seq integer primary key autoincrement,
      collection text not null,
      item_key text not null,
      constraint semantic_outbox_key_unique unique (collection, item_key)
    )
  `.execute(db)

  // Change capture for the two core collections. Guarded by the enabled flag, so a person who
  // never turns semantic search on pays one EXISTS probe per write and stores nothing.
  // `INSERT OR REPLACE` moves a re-changed key to the end of the queue instead of duplicating it.
  for (const [name, table, when, collection] of [
    ['messages_insert', 'agent_messages', 'AFTER INSERT', 'chat.messages'],
    ['messages_text', 'agent_messages', 'AFTER UPDATE OF search_text', 'chat.messages'],
    ['messages_delete', 'agent_messages', 'AFTER DELETE', 'chat.messages'],
    ['sessions_insert', 'agent_sessions', 'AFTER INSERT', 'chat.sessions'],
    ['sessions_title', 'agent_sessions', 'AFTER UPDATE OF title', 'chat.sessions'],
    ['sessions_delete', 'agent_sessions', 'AFTER DELETE', 'chat.sessions'],
  ] as const) {
    const row = when === 'AFTER DELETE' ? 'old' : 'new'
    await sql
      .raw(
        `CREATE TRIGGER semantic_outbox_${name} ${when} ON ${table} WHEN ${ENABLED} BEGIN ` +
          `INSERT OR REPLACE INTO semantic_outbox (collection, item_key) VALUES ('${collection}', ${row}.id); END`,
      )
      .execute(db)
  }
}
