import { sql, type Kysely } from 'kysely'

// A queued agent turn named the agent that answers it `speakerAgentId`, a word from when several
// agents shared a chat; it is `agentId` now. A wake kept in the outbox until its session's queue
// admits it carries the same `to` address the queue rows were rewritten for
// (`20261115T000000_agent_terms`): `{ participant: 'agent:<id>', handle }` → `{ agentId: '<id>' }`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.agentTurn.agentId', json_extract(payload_json, '$.agentTurn.speakerAgentId'),
        '$.agentTurn.scope.agentId', json_extract(payload_json, '$.agentTurn.scope.speakerAgentId')
      ),
      '$.agentTurn.speakerAgentId', '$.agentTurn.scope.speakerAgentId'
    )
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.agentTurn.speakerAgentId') = 'text'
  `.execute(db)

  await sql`
    UPDATE wake_outbox
    SET request_json = json_remove(
      json_set(request_json, '$.to.agentId', substr(json_extract(request_json, '$.to.participant'), 7)),
      '$.to.participant', '$.to.handle'
    )
    WHERE json_valid(request_json)
      AND json_type(request_json, '$.to.participant') = 'text'
  `.execute(db)
}
