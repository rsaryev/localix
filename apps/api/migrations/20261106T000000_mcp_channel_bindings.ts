import { sql, type Kysely } from 'kysely'

// Which conversation a Claude Code channel server speaks into (`features/mcp/mcp-channels.ts`):
// the chat that last gathered the server, kept so a restart starts the channel again and its
// events reach that chat before its next turn. One row per server and working directory; a
// deleted conversation takes its bindings with it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE mcp_channel_bindings (
      user_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      bound_at TEXT NOT NULL,
      PRIMARY KEY (user_id, server_id, cwd)
    )
  `.execute(db)
}
