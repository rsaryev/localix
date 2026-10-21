import type { Kysely } from 'kysely'

import { retrySqliteBusy, type AppDatabase } from '../../../db'
import { safeJsonParse } from '../../../lib/json'

/**
 * The chat-owned routes route repair reads and rebinds: seats (what a run reads) and the session
 * choice map (what an agent joining later reads). Every write is guarded by the value it replaces,
 * so a pick the person made after the read is never overwritten.
 */

export interface SeatRoute {
  sessionId: string
  agentId: string
  providerConnectionId: string | null
  modelId: string
}

export interface ChoiceRoute {
  sessionId: string
  agentId: string
  providerConnectionId: string
  modelId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function choiceRoutes(sessionId: string, raw: string | null): ChoiceRoute[] {
  const parsed = safeJsonParse<unknown>(raw)
  if (!isRecord(parsed) || !isRecord(parsed.agents)) return []
  return Object.entries(parsed.agents).flatMap(([agentId, route]) =>
    isRecord(route) &&
    typeof route.modelId === 'string' &&
    typeof route.providerConnectionId === 'string'
      ? [
          {
            sessionId,
            agentId,
            modelId: route.modelId,
            providerConnectionId: route.providerConnectionId,
          },
        ]
      : [],
  )
}

export function createRouteSeatsRepository(db: Kysely<AppDatabase>) {
  return {
    async seats(userId: string): Promise<SeatRoute[]> {
      return db
        .selectFrom('conversation_participants as seat')
        .innerJoin('agent_sessions as session', 'session.id', 'seat.session_id')
        .select([
          'seat.session_id as sessionId',
          'seat.agent_id as agentId',
          'seat.provider_connection_id as providerConnectionId',
          'seat.model_id as modelId',
        ])
        .where('session.user_id', '=', userId)
        .execute()
    },

    /** Rebind one seat; false when it no longer holds the route that was read. */
    async rebindSeat(seat: SeatRoute, to: string): Promise<boolean> {
      const result = await retrySqliteBusy(() =>
        db
          .updateTable('conversation_participants')
          .set({ provider_connection_id: to })
          .where('session_id', '=', seat.sessionId)
          .where('agent_id', '=', seat.agentId)
          .where('model_id', '=', seat.modelId)
          .where((eb) =>
            seat.providerConnectionId === null
              ? eb('provider_connection_id', 'is', null)
              : eb('provider_connection_id', '=', seat.providerConnectionId),
          )
          .executeTakeFirst(),
      )
      return Number(result.numUpdatedRows) > 0
    },

    async choices(userId: string): Promise<ChoiceRoute[]> {
      const rows = await db
        .selectFrom('agent_sessions')
        .select(['id', 'model_choices'])
        .where('user_id', '=', userId)
        .where('model_choices', 'is not', null)
        .execute()
      return rows.flatMap((row) => choiceRoutes(row.id, row.model_choices))
    },

    /** Rebind one choice entry, keeping the rest of the stored map (stamps included) as it is. */
    async rebindChoice(choice: ChoiceRoute, to: string): Promise<boolean> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('agent_sessions')
            .select('model_choices')
            .where('id', '=', choice.sessionId)
            .executeTakeFirst()
          const parsed = safeJsonParse<unknown>(row?.model_choices)
          if (!isRecord(parsed) || !isRecord(parsed.agents)) return false
          const route = parsed.agents[choice.agentId]
          if (
            !isRecord(route) ||
            route.modelId !== choice.modelId ||
            route.providerConnectionId !== choice.providerConnectionId
          )
            return false
          route.providerConnectionId = to
          await trx
            .updateTable('agent_sessions')
            .set({ model_choices: JSON.stringify(parsed) })
            .where('id', '=', choice.sessionId)
            .execute()
          return true
        }),
      )
    },

    /** Every user who owns a chat: whose routes a full reconcile visits. */
    async owners(): Promise<string[]> {
      const rows = await db.selectFrom('agent_sessions').select('user_id').distinct().execute()
      return rows.map((row) => row.user_id)
    },
  }
}

export type RouteSeatsRepository = ReturnType<typeof createRouteSeatsRepository>
