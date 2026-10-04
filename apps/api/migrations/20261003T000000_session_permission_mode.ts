import { sql, type Kysely } from 'kysely'

// The session's permission mode (`capabilities/permission-modes.ts`): how the agent's rules are
// rewritten for this conversation's runs. Stored on the ROOT session; a delegated child reads its
// root's, so turning a mode off reaches every child on its next run.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'default'`.execute(
    db,
  )
}
