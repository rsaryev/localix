import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { RecentRoute, RecentRoutes } from './repository-types'

/**
 * THE MODEL EACH AGENT USED MOST RECENTLY — the "recent" level of the model chain.
 *
 * A session's `model_selected_at` is stamped only when someone picked its model (or stated one at
 * birth); the newest stamp per agent is that agent's recent route, with the reasoning level it
 * ran at when that was picked as well (`reasoning_selected_at`). Reopening an old conversation
 * stamps nothing, so it never makes an old model the agent's newest preference again, and
 * `is_pinned` plays no part: pinning is about where a conversation sits in the sidebar.
 */
export function createRecentRouteQueries(db: Kysely<AppDatabase>) {
  return {
    /**
     * Whether the session's model is the person's own pick (stamped when picked, or stated when
     * the session was born) rather than a default filled in from a card, the project or a plugin.
     */
    async isSessionModelChosen(userId: string, sessionId: string) {
      const row = await db
        .selectFrom('agent_sessions')
        .select('model_selected_at')
        .where('user_id', '=', userId)
        .where('id', '=', sessionId)
        .executeTakeFirst()
      return Boolean(row?.model_selected_at)
    },

    async listRecentRoutes(userId: string): Promise<RecentRoutes> {
      const rows = await db
        .selectFrom('agent_sessions')
        .select([
          'agent_id',
          'provider_connection_id',
          'model_id',
          'reasoning_effort',
          'reasoning_selected_at',
        ])
        .where('user_id', '=', userId)
        .where('agent_id', 'is not', null)
        .where('model_id', '!=', '')
        .where('model_selected_at', 'is not', null)
        .orderBy('model_selected_at', 'asc')
        .execute()
      const byAgent = new Map<string, RecentRoute>()
      // Ascending, so the newest pick of each agent is the one left in the map.
      for (const row of rows) {
        byAgent.set(row.agent_id!, {
          providerConnectionId: row.provider_connection_id,
          modelId: row.model_id,
          // The level only travels when it was picked too, not filled in from a default.
          ...(row.reasoning_selected_at ? { reasoningEffort: row.reasoning_effort } : {}),
        })
      }
      return { byAgent }
    },
  }
}
