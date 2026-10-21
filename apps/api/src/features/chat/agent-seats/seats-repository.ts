import type { Kysely, Transaction } from 'kysely'

import { retrySqliteBusy, type AppDatabase } from '../../../db'
import { safeJsonParse } from '../../../lib/json'
import { recordSessionChanges } from '../session-changes'

/** The chat-owned rows that name an agent: its seats and its entries in the choice maps. */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export interface SeatOfAgent {
  sessionId: string
  agentId: string
  handle: string
  projectId: string
}

/**
 * Say these chats changed, in the writer's transaction, grouped by owner. Route repair and agent
 * seats ignore `chat.session`, so their own notices never wake them again.
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

export function createAgentSeatsRepository(db: Kysely<AppDatabase>) {
  return {
    /** Every seat, with the project its chat belongs to (where the agent is looked up). */
    async seats(agentId?: string): Promise<SeatOfAgent[]> {
      let query = db
        .selectFrom('conversation_participants as seat')
        .innerJoin('agent_sessions as session', 'session.id', 'seat.session_id')
        .select([
          'seat.session_id as sessionId',
          'seat.agent_id as agentId',
          'seat.handle as handle',
          'session.project_id as projectId',
        ])
      if (agentId) query = query.where('seat.agent_id', '=', agentId)
      return query.execute()
    },

    /** The seats' display handle follows the agent's; returns the sessions that changed. */
    async rename(agentId: string, handle: string): Promise<string[]> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const rows = await trx
            .updateTable('conversation_participants')
            .set({ handle })
            .where('agent_id', '=', agentId)
            .where('handle', '!=', handle)
            .returning('session_id')
            .execute()
          const sessions = [...new Set(rows.map((row) => row.session_id))]
          await announceSessions(trx, sessions)
          return sessions
        }),
      )
    },

    /**
     * A deleted agent leaves every room it shared with someone else. Alone in a chat it keeps its
     * seat: the chat reads as one whose agent is unavailable (`requireRunAgent`), and the person
     * picks another there, rather than finding a conversation with nobody in it.
     */
    async leaveRooms(agentId: string): Promise<string[]> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const shared = await trx
            .selectFrom('conversation_participants as seat')
            .select('seat.session_id')
            .where('seat.agent_id', '=', agentId)
            .where((eb) =>
              eb.exists(
                eb
                  .selectFrom('conversation_participants as other')
                  .select('other.agent_id')
                  .whereRef('other.session_id', '=', 'seat.session_id')
                  .where('other.agent_id', '!=', agentId),
              ),
            )
            .execute()
          const sessions = shared.map((row) => row.session_id)
          if (sessions.length === 0) return []
          await trx
            .deleteFrom('conversation_participants')
            .where('agent_id', '=', agentId)
            .where('session_id', 'in', sessions)
            .execute()
          await announceSessions(trx, sessions)
          return sessions
        }),
      )
    },

    /** Drop the agent's entry (and its stamp: a recent pick) from every choice map. */
    async forgetChoices(agentId: string): Promise<string[]> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const rows = await trx
            .selectFrom('agent_sessions')
            .select(['id', 'model_choices'])
            .where('model_choices', 'like', `%${JSON.stringify(agentId).slice(1, -1)}%`)
            .execute()
          const changed: string[] = []
          for (const row of rows) {
            const parsed = safeJsonParse<unknown>(row.model_choices)
            if (!isRecord(parsed) || !isRecord(parsed.agents) || !(agentId in parsed.agents))
              continue
            delete parsed.agents[agentId]
            if (isRecord(parsed.chosenAt)) delete parsed.chosenAt[agentId]
            await trx
              .updateTable('agent_sessions')
              .set({ model_choices: JSON.stringify(parsed) })
              .where('id', '=', row.id)
              .execute()
            changed.push(row.id)
          }
          await announceSessions(trx, changed)
          return changed
        }),
      )
    },
  }
}

export type AgentSeatsRepository = ReturnType<typeof createAgentSeatsRepository>
