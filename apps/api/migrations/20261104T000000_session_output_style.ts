import { sql, type Kysely } from 'kysely'

// The conversation's output style (Claude Code's `/output-style`): the name of a plugin's style,
// `<plugin>:<name>`, whose instructions shape every reply; null is the default style.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN output_style TEXT`.execute(db)
}
