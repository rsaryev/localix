import { sql, type Kysely } from 'kysely'

// The session's conversation mode (`features/chat/conversation-modes.ts`): `solo` is one agent with
// the person and no team protocol, `group` lets agents join, hand work on and pass. Every chat that
// exists already behaves as a group — a lone agent could always bring a colleague in — so existing
// rows keep that behaviour; a new chat chooses its mode when it is created.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'group'`.execute(
    db,
  )
}
