import { sql, type Kysely } from 'kysely'

// Restored under the name databases already recorded. This migration once ran with this name and
// was then renamed in place, and every database that had run it refused to boot ("previously
// executed migration … is missing"). A migration is immutable from the moment ANY database runs
// it — a developer's included, since the dev server applies migrations on save — so it is kept
// exactly as it ran, and the column it added and the product dropped is removed by a later one
// (`20261009T000000_session_plans_drop_executor`).
//
// `executor_agent_id` — the agent chosen to implement an approved plan (since dropped).
// `awaiting_person` — the version waits on the person's decision; set when presented or
// restored, cleared when a review is sent back. The backfill marks exactly the rows the old
// rebuild rule (`status = 'presented' AND review_round = 0`) would have rebuilt.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "session_plans" ADD COLUMN "executor_agent_id" text`.execute(db)
  await sql`
    ALTER TABLE "session_plans"
    ADD COLUMN "awaiting_person" integer NOT NULL DEFAULT 0 CHECK ("awaiting_person" IN (0, 1))
  `.execute(db)
  await sql`
    UPDATE "session_plans" SET "awaiting_person" = 1
    WHERE "status" = 'presented' AND "review_round" = 0
  `.execute(db)
}
