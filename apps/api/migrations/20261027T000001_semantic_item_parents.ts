import { sql, type Kysely } from 'kysely'

// Messages embedded before items named a parent: name their chat, so deleting the chat removes
// their vectors too.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE semantic_items
    SET parent = (SELECT m.session_id FROM agent_messages AS m WHERE m.id = semantic_items.item_key)
    WHERE collection = 'chat.messages' AND parent IS NULL
  `.execute(db)
}
