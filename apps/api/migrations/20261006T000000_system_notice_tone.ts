import { sql, type Kysely } from 'kysely'

/**
 * Stored transcript notices move onto the app's one tone vocabulary and the recovery list.
 *
 * A notice's tone was `info | warning | success | muted` — no `error`, and `muted` where every
 * other surface says `neutral` — and its `recovery` was the bare string `'retry'`. The codec reads
 * only the current shape (`payload-codec.ts` keeps no compatibility branch), so a row written
 * before this change would reach the renderer with a tone its map has no class for and a
 * recovery it would not iterate. Two in-place JSON rewrites, scoped to the rows that need them:
 *
 *   systemNotice.tone      'muted'  → 'neutral'
 *   systemNotice.recovery  'retry'  → ['retry']
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE agent_messages
    SET payload_json = json_set(payload_json, '$.systemNotice.tone', 'neutral')
    WHERE json_valid(payload_json)
      AND json_extract(payload_json, '$.systemNotice.tone') = 'muted'
  `.execute(db)
  await sql`
    UPDATE agent_messages
    SET payload_json = json_set(payload_json, '$.systemNotice.recovery', json_array('retry'))
    WHERE json_valid(payload_json)
      AND json_type(payload_json, '$.systemNotice.recovery') = 'text'
  `.execute(db)
}
