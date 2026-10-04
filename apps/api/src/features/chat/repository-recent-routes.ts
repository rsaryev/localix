import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { RecentRoutes } from './repository-types'

/**
 * THE ROUTES THE USER LAST CHOSE — the "recent" level of the model chain.
 *
 * A seat holds a model only when someone picked one for that participant in that conversation.
 * `model_selected_at` records that event separately from conversation activity: reopening an old
 * Flash conversation must not make Flash the agent's newest preference again.
 *
 * Its own module rather than another method on the session reader, because it answers a
 * different question: every query there is "what is this session", and this one is "what has
 * this person been choosing" — over all of them at once, grouped by agent.
 */

/**
 * Every eligible seat, newest first, once for the model and once for the level.
 *
 * TWO orderings because the two fields are chosen independently: a later chat where only the
 * level was touched would otherwise hide the model chosen before it. The reducer below takes the
 * first row per agent. This avoids relying on SQLite's bare-column behavior beside `MAX()` and
 * makes ties deterministic.
 *
 * Every participant of a room counts, not only the one at position 0: a model chosen for the
 * third member is a choice, and reading position 0 alone silently dropped it.
 *
 * `is_pinned` is deliberately absent from the ordering — the query this replaced led with it,
 * which made "the model I last used" mean "the model in my oldest pinned chat". Pinning is about
 * where a conversation sits in the sidebar.
 */
export function createRecentRouteQueries(db: Kysely<AppDatabase>) {
  const modelsNewestFirst = (userId: string) =>
    db
      .selectFrom('agent_sessions')
      .innerJoin('conversation_participants as route', 'route.session_id', 'agent_sessions.id')
      .select([
        'route.agent_id',
        'route.provider_connection_id',
        'route.model_id',
        'route.model_selected_at as chosen_at',
      ])
      .where('agent_sessions.user_id', '=', userId)
      .where('route.model_id', '!=', '')
      .where('route.model_selected_at', 'is not', null)
      .orderBy('route.model_selected_at', 'desc')
      .orderBy('route.session_id', 'desc')
      .orderBy('route.position', 'desc')
      .execute()

  const effortsNewestFirst = (userId: string) => {
    const query = db
      .selectFrom('agent_sessions')
      .innerJoin('conversation_participants as route', 'route.session_id', 'agent_sessions.id')
      .select(['route.agent_id', 'route.reasoning_effort'])
      .where('agent_sessions.user_id', '=', userId)
      .orderBy('agent_sessions.updated_at', 'desc')
      .orderBy('route.session_id', 'desc')
      .orderBy('route.position', 'desc')
    return query.execute()
  }

  return {
    async listRecentRoutes(userId: string): Promise<RecentRoutes> {
      const [models, efforts] = await Promise.all([
        modelsNewestFirst(userId),
        effortsNewestFirst(userId),
      ])
      const byAgent = new Map<string, { providerConnectionId: string | null; modelId: string }>()
      for (const row of models) {
        if (!row.chosen_at) continue
        const route = {
          providerConnectionId: row.provider_connection_id,
          modelId: row.model_id,
        }
        if (!byAgent.has(row.agent_id)) byAgent.set(row.agent_id, route)
      }
      const effortByAgent = new Map<string, (typeof efforts)[number]['reasoning_effort']>()
      for (const row of efforts) {
        if (!effortByAgent.has(row.agent_id)) {
          effortByAgent.set(row.agent_id, row.reasoning_effort)
        }
      }
      return {
        byAgent,
        effortByAgent,
      }
    },
  }
}
