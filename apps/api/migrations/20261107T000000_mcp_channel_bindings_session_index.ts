import { sql, type Kysely } from 'kysely'

// Finds a conversation's channel bindings (`features/mcp/mcp-channels.ts`) without scanning the
// table, as a deleted conversation's cascade and a chat's channel list both do.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS mcp_channel_bindings_session_idx
    ON mcp_channel_bindings(session_id)
  `.execute(db)
}
