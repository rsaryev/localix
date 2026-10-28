import { sql, type Kysely } from 'kysely'

// A session has one agent for its whole life, so a row that belongs to a session never needs to
// say which agent it is for. Three stored copies did, and each is removed:
//
//   session_plans.author_agent_id  the agent that presented the plan
//   work_records.agent_id        the agent whose run started the work
//   agent_turn_starts.agent_id   the agent whose reply slot a turn took
//   queued agent turns           `agentTurn.agentId` and `agentTurn.scope.agentId` in the payload
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE session_plans DROP COLUMN author_agent_id`.execute(db)
  await sql`ALTER TABLE work_records DROP COLUMN agent_id`.execute(db)
  await sql`ALTER TABLE agent_turn_starts DROP COLUMN agent_id`.execute(db)
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_remove(payload_json, '$.agentTurn.agentId', '$.agentTurn.scope.agentId')
    WHERE json_valid(payload_json) AND json_type(payload_json, '$.agentTurn') = 'object'
  `.execute(db)
}
