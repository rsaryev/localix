import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { RecentRoute, RecentRoutes } from './repository-types'
import { parseModelChoices } from './session-model-choices'

/**
 * THE MODEL EACH AGENT USED MOST RECENTLY — the "recent" level of the model chain.
 *
 * Two records of a pick, both written by the one choice writer (`repository-model-choices.ts`):
 * a seat's `model_selected_at` (a model picked for a participant, or stated at birth), and a
 * session's choice-map stamp (`model_choices.chosenAt`), which also covers a pick for an agent
 * that was never seated — the picker's "All" cascade names every listed agent. The newest of the
 * two wins per agent. Reopening an old conversation stamps nothing, so it never makes an old
 * model the agent's newest preference again.
 *
 * Its own module rather than another method on the session reader, because it answers a
 * different question: every query there is "what is this session", and this one is "what has
 * this person been choosing" — over all of them at once, grouped by agent.
 *
 * Every participant of a room counts, not only the one at position 0, and `is_pinned` plays no
 * part: pinning is about where a conversation sits in the sidebar.
 */
export function createRecentRouteQueries(db: Kysely<AppDatabase>) {
  const seatPicks = (userId: string) =>
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
      .execute()

  const choiceMaps = (userId: string) =>
    db
      .selectFrom('agent_sessions')
      .select('model_choices')
      .where('user_id', '=', userId)
      .where('model_choices', 'is not', null)
      .execute()

  return {
    async listRecentRoutes(userId: string): Promise<RecentRoutes> {
      const [seats, maps] = await Promise.all([seatPicks(userId), choiceMaps(userId)])
      const newest = new Map<string, { at: string; route: RecentRoute }>()
      const offer = (agentId: string, at: string, route: RecentRoute) => {
        const held = newest.get(agentId)
        // Seats are offered first and a tie goes to the later offer: one pick stamps its seat and
        // its entry in the same transaction, and the entry also knows the level.
        if (!held || at >= held.at) newest.set(agentId, { at, route })
      }
      for (const row of seats) {
        if (!row.chosen_at) continue
        offer(row.agent_id, row.chosen_at, {
          providerConnectionId: row.provider_connection_id,
          modelId: row.model_id,
        })
      }
      for (const row of maps) {
        const choices = parseModelChoices(row.model_choices)
        for (const [agentId, at] of Object.entries(choices.chosenAt ?? {})) {
          const route = choices.agents[agentId]
          if (route) offer(agentId, at, route)
        }
      }
      return { byAgent: new Map([...newest].map(([agentId, { route }]) => [agentId, route])) }
    },
  }
}
