import { sql, type Kysely } from 'kysely'

// A session has one agent for its whole life, so nothing needs to say WHICH agent a stored value
// is for. Two addresses did: a queued wake or a kept outbox wake carried `to: { agentId }`, and a
// delegated child or a skill fork recorded `parentAgentId`, the agent that spawned it. Both are
// removed; the session they belong to names its agent.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_remove(payload_json, '$.to')
    WHERE json_valid(payload_json) AND json_type(payload_json, '$.to') IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE wake_outbox
    SET request_json = json_remove(request_json, '$.to')
    WHERE json_valid(request_json) AND json_type(request_json, '$.to') IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE agent_sessions
    SET invocation_json = json_remove(invocation_json, '$.parentAgentId')
    WHERE json_valid(invocation_json) AND json_type(invocation_json, '$.parentAgentId') IS NOT NULL
  `.execute(db)
}
