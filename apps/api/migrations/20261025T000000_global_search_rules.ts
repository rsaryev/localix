import { sql, type Kysely } from 'kysely'

// `history_search` became a mode of `global_search`: a rule written for the old tool keeps
// governing the same calls under the new name instead of silently stopping to apply.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE capability_rule SET action = 'tool:global_search' WHERE action = 'tool:history_search'
  `.execute(db)
}
