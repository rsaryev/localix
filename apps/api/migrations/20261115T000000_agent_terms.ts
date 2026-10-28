import { sql, type Kysely } from 'kysely'

// With one agent per chat the stored rows no longer need the group-chat vocabulary:
//
//   queued wake `to`            { participant: 'agent:<id>', handle } → { agentId: '<id>' }
//   task-delegation provenance  parentParticipant: 'agent:<id>'      → parentAgentId: '<id>'
//   message payloads            authorSnapshot, to, toSnapshot       → gone (nothing reads them)
//   message reactions           only the person reacts               → an agent's mark is dropped
//   system notices              participant (keyed a per-agent slot) → gone
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_remove(
      json_set(payload_json, '$.to.agentId', substr(json_extract(payload_json, '$.to.participant'), 7)),
      '$.to.participant', '$.to.handle'
    )
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.to.participant') = 'text'
  `.execute(db)

  await sql`
    UPDATE agent_sessions
    SET invocation_json = json_remove(
      json_set(
        invocation_json,
        '$.parentAgentId', substr(json_extract(invocation_json, '$.parentParticipant'), 7)
      ),
      '$.parentParticipant'
    )
    WHERE json_valid(invocation_json)
      AND json_type(invocation_json, '$.parentParticipant') = 'text'
  `.execute(db)

  await sql`
    UPDATE agent_messages
    SET payload_json = json_remove(payload_json, '$.authorSnapshot', '$.to', '$.toSnapshot')
    WHERE json_valid(payload_json)
      AND (
        json_type(payload_json, '$.authorSnapshot') IS NOT NULL
        OR json_type(payload_json, '$.to') IS NOT NULL
        OR json_type(payload_json, '$.toSnapshot') IS NOT NULL
      )
  `.execute(db)

  await sql`
    UPDATE agent_messages
    SET payload_json = json_set(
      payload_json,
      '$.reactions',
      json((
        SELECT json_group_array(json(r.value))
        FROM json_each(payload_json, '$.reactions') r
        WHERE json_extract(r.value, '$.from') = 'user'
      ))
    )
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.reactions') = 'array'
      AND EXISTS (
        SELECT 1 FROM json_each(payload_json, '$.reactions') r
        WHERE json_extract(r.value, '$.from') != 'user'
      )
  `.execute(db)

  await sql`
    UPDATE agent_messages
    SET payload_json = json_remove(payload_json, '$.systemNotice.participant')
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.systemNotice.participant') IS NOT NULL
  `.execute(db)
}
