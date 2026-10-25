import { sql, type Kysely } from 'kysely'

// A skill folder is shared with Claude Code (`.claude/skills`), whose use Localix cannot see. This
// marks the skills made in Localix, the only ones the curator archives when idle.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE skill_usage ADD COLUMN localix_authored integer NOT NULL DEFAULT 0
  `.execute(db)
}
