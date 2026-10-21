import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'

/** The reads behind pruning: which conversations are old enough, and how much they hold. */
export function createStorageRepository(db: Kysely<AppDatabase>) {
  return {
    /** Root sessions with no message since `cutoff`; pinned and running ones are excluded. */
    async pruneCandidates(userId: string, cutoff: string): Promise<string[]> {
      const rows = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('user_id', '=', userId)
        .where('parent_session_id', 'is', null)
        .where('is_pinned', '=', 0)
        .where('runtime_status', '<>', 'running')
        .where('last_message_at', '<', cutoff)
        .execute()
      return rows.map((row) => row.id)
    },
    /** Message and tool-output bytes held by these roots and their sub-agent sessions. */
    async bytesOf(userId: string, roots: readonly string[]): Promise<number> {
      let bytes = 0
      for (let at = 0; at < roots.length; at += 200) {
        const list = sql.join(roots.slice(at, at + 200))
        const scope = sql`session_id IN (SELECT id FROM agent_sessions WHERE user_id = ${userId} AND (id IN (${list}) OR root_session_id IN (${list})))`
        const messages = await sql<{ n: number | null }>`
          SELECT SUM(LENGTH(payload_json)) AS n FROM agent_messages WHERE ${scope}`.execute(db)
        const outputs = await sql<{ n: number | null }>`
          SELECT SUM(byte_length) AS n FROM tool_output_artifacts WHERE ${scope}`.execute(db)
        bytes += Number(messages.rows[0]?.n ?? 0) + Number(outputs.rows[0]?.n ?? 0)
      }
      return bytes
    },
  }
}
