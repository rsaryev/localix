import { sql, type Kysely } from 'kysely'

// Vectors of chats and messages that no longer exist: drop them once, before the change feed
// keeps the index clean from here on.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM semantic_items
    WHERE (collection = 'chat.messages'
        AND NOT EXISTS (SELECT 1 FROM agent_messages AS m WHERE m.id = semantic_items.item_key))
       OR (collection = 'chat.sessions'
        AND NOT EXISTS (SELECT 1 FROM agent_sessions AS s WHERE s.id = semantic_items.item_key))
  `.execute(db)
}
