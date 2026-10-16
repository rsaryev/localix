import { sql } from 'kysely'

/** Legacy outputs need an attributed message; an unknown author never grants access. */
export function participantOutputPredicate(
  participant: string | undefined,
  table: 'tool_output_artifacts' | 'tool_output_chunks',
) {
  if (!participant) return sql<boolean>`1 = 1`
  const user = sql.ref(`${table}.user_id`)
  const session = sql.ref(`${table}.session_id`)
  const call = sql.ref(`${table}.tool_call_id`)
  const owner = sql`(SELECT artifact.participant FROM tool_output_artifacts AS artifact
    WHERE artifact.user_id = ${user} AND artifact.session_id = ${session}
      AND artifact.tool_call_id = ${call})`
  return sql<boolean>`(${owner} = ${participant} OR (${owner} IS NULL AND EXISTS (
    SELECT 1 FROM agent_messages AS message, json_each(message.payload_json, '$.items') AS item
    WHERE message.user_id = ${user} AND message.session_id = ${session}
      AND json_extract(message.payload_json, '$.from') = ${participant}
      AND json_extract(item.value, '$.toolCallId') = ${call}
  )))`
}
