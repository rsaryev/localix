import { sql, type Kysely } from 'kysely'

// Approving a plan no longer names an executor: the approval is addressed like any message in the
// conversation, so `executor_agent_id` (added by `20261008T000000_session_plans_executor_and_awaiting`)
// has no reader. Dropped by a new migration rather than by editing the one that added it, because
// databases have already run that one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "session_plans" DROP COLUMN "executor_agent_id"`.execute(db)
}
