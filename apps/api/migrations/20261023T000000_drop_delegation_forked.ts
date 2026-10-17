import { sql, type Kysely } from 'kysely'

/**
 * `fork` became `delegate`, and a delegated child no longer records whether it was a fork: every
 * child the tool creates is the delegator's to manage, whatever agent runs it. The flag goes from
 * stored provenance, which the strict parser would otherwise refuse.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE agent_sessions
    SET invocation_json = json_remove(invocation_json, '$.forked')
    WHERE json_extract(invocation_json, '$.kind') = 'task-delegation'
      AND json_type(invocation_json, '$.forked') IS NOT NULL
  `.execute(db)
}
