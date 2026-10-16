import { sql, type Kysely } from 'kysely'

// Who set a plan version aside. Leaving Plan mode dismisses the waiting version on the person's
// behalf, and without this column that was indistinguishable from the person's own dismissal —
// so returning to Plan mode could not bring the version back (LOCALIX-203: the agent re-typed it
// as a new version instead). 'mode' comes back on its own; 'person' only when the person reopens.
// A new nullable column, so a plain ADD COLUMN; existing dismissed rows read as unknown (null),
// which is never auto-restored.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "session_plans"
    ADD COLUMN "dismissed_by" text CHECK ("dismissed_by" IN ('person', 'mode'))
  `.execute(db)
}
