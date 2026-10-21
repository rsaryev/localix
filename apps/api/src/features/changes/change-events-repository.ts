/** Reads of the core's change notices that a consumer needs beyond the one it was handed. */
import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { CORE_STREAM } from './core-entities'

/** True when the agent's stable id was upserted after its latest deletion (a rename). */
export async function agentLivesOn(db: Kysely<AppDatabase>, agentId: string): Promise<boolean> {
  const rows = await db
    .selectFrom('change_events')
    .select(['seq', 'op'])
    .where('stream', '=', CORE_STREAM)
    .where('entity', '=', 'agent')
    .where(sql<string>`json_extract(ref_json, '$.agentId')`, '=', agentId)
    .orderBy('seq', 'desc')
    .limit(1)
    .execute()
  return rows[0]?.op === 'upserted'
}
