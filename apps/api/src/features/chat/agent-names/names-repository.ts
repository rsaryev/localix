import type { Kysely, Transaction } from 'kysely'

import { retrySqliteBusy, type AppDatabase } from '../../../db'
import { recordSessionChanges } from '../session-changes'

/** The chat-owned rows that name an agent: the sessions it is the agent of. */

export interface SessionAgentRef {
  sessionId: string
  agentId: string
  name: string
  projectId: string
}

/**
 * Say these chats changed, in the writer's transaction, grouped by owner. Route repair and agent
 * routes ignore `chat.session`, so their own notices never wake them again.
 */
async function announceSessions(
  trx: Transaction<AppDatabase>,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return
  const rows = await trx
    .selectFrom('agent_sessions')
    .select(['id', 'user_id'])
    .where('id', 'in', [...sessionIds])
    .execute()
  const byUser = new Map<string, string[]>()
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.id])
  for (const [userId, ids] of byUser) await recordSessionChanges(trx, userId, ids)
}

export function createAgentNamesRepository(db: Kysely<AppDatabase>) {
  return {
    /** Every session with an agent, with the project it belongs to (where the agent is looked up). */
    async sessionAgents(agentId?: string): Promise<SessionAgentRef[]> {
      let query = db
        .selectFrom('agent_sessions')
        .select([
          'id as sessionId',
          'agent_id as agentId',
          'agent_name as name',
          'project_id as projectId',
        ])
        .where('agent_id', 'is not', null)
      if (agentId) query = query.where('agent_id', '=', agentId)
      const rows = await query.execute()
      return rows.map((row) => ({ ...row, agentId: row.agentId!, name: row.name! }))
    },

    /** The sessions' display name follows the agent's; returns the sessions that changed. */
    async rename(agentId: string, name: string): Promise<string[]> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const rows = await trx
            .updateTable('agent_sessions')
            .set({ agent_name: name })
            .where('agent_id', '=', agentId)
            .where('agent_name', '!=', name)
            .returning('id')
            .execute()
          const sessions = rows.map((row) => row.id)
          await announceSessions(trx, sessions)
          return sessions
        }),
      )
    },
  }
}

export type AgentNamesRepository = ReturnType<typeof createAgentNamesRepository>
