import { sql, type Kysely } from 'kysely'

// `delegate` became Claude Code's `Agent`: a rule written for the old tool keeps governing the
// same calls under the new name, so a tool someone switched off does not quietly come back on.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE capability_rule SET action = 'tool:Agent' WHERE action = 'tool:delegate'
  `.execute(db)
}
