import { sql, type Kysely } from 'kysely'

// `awaiting_person` was set when a version was presented or restored and cleared only when a
// review reached the agent, so a version approved, dismissed, superseded or completed kept
// `awaiting_person = 1` (LOCALIX-206). The repository now clears it on every write that leaves
// `presented`; this brings the rows written before that into the same invariant: the flag is
// set only on a presented version.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE "session_plans" SET "awaiting_person" = 0 WHERE "status" <> 'presented'`.execute(
    db,
  )
}
