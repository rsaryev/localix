import type { Kysely } from 'kysely'

import { retrySqliteBusy, type AppDatabase } from '../../../db'
import { recordSessionChanges } from '../session-changes'

/**
 * The chat-owned routes route repair reads and rebinds: each session's agent route. Every write
 * is guarded by the value it replaces, so a pick the person made after the read is never
 * overwritten.
 */

export interface RepairableRoute {
  userId: string
  sessionId: string
  agentId: string
  providerConnectionId: string | null
  modelId: string
}

export function createRouteRepairRepository(db: Kysely<AppDatabase>) {
  return {
    async routes(userId: string): Promise<RepairableRoute[]> {
      const rows = await db
        .selectFrom('agent_sessions')
        .select([
          'user_id as userId',
          'id as sessionId',
          'agent_id as agentId',
          'provider_connection_id as providerConnectionId',
          'model_id as modelId',
        ])
        .where('user_id', '=', userId)
        .where('agent_id', 'is not', null)
        .orderBy('id')
        .execute()
      return rows.map((row) => ({ ...row, agentId: row.agentId! }))
    },

    /**
     * Rebind one route; false when it no longer holds the route that was read. The chat's notice is
     * recorded with the write; route repair ignores `chat.session`, so it never wakes itself.
     */
    async rebindRoute(route: RepairableRoute, to: string): Promise<boolean> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const result = await trx
            .updateTable('agent_sessions')
            .set({ provider_connection_id: to })
            .where('id', '=', route.sessionId)
            .where('agent_id', '=', route.agentId)
            .where('model_id', '=', route.modelId)
            .where((eb) =>
              route.providerConnectionId === null
                ? eb('provider_connection_id', 'is', null)
                : eb('provider_connection_id', '=', route.providerConnectionId),
            )
            .executeTakeFirst()
          const moved = Number(result.numUpdatedRows) > 0
          if (moved) await recordSessionChanges(trx, route.userId, [route.sessionId])
          return moved
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

export type RouteRepairRepository = ReturnType<typeof createRouteRepairRepository>
