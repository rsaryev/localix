import type { Kysely } from 'kysely'

import { retrySqliteBusy, type AppDatabase } from '../../db'
import { writeAgentRoute } from './repository-conversation-participants'
import {
  parseModelChoices,
  recordModelChoices,
  type ModelChoiceRoute,
} from './session-model-choices'

/**
 * THE ONE WRITER OF A PERSON'S MODEL CHOICE in a session — the picker (one agent, or the "All"
 * cascade: every listed agent named) and `/model` both land here.
 *
 * One transaction writes the seated agents' rows (what their runs read) and the session's choice
 * map (what an agent not seated yet joins on), so no run reads half a room moved and no later
 * invitation reads a choice the seats disagree with. An agent that is not seated gets only its
 * entry. Each entry is stamped, which is what makes it "the model this agent used most
 * recently" for the next conversation (`repository-recent-routes.ts`).
 */
export async function writeModelChoices(
  db: Kysely<AppDatabase>,
  userId: string,
  sessionId: string,
  routes: readonly ModelChoiceRoute[],
): Promise<void> {
  await retrySqliteBusy(() =>
    db.transaction().execute(async (trx) => {
      const owned = await trx
        .selectFrom('agent_sessions')
        .select('model_choices')
        .where('user_id', '=', userId)
        .where('id', '=', sessionId)
        .executeTakeFirst()
      if (!owned) return
      const seatRows = await trx
        .selectFrom('conversation_participants')
        .select(['agent_id', 'provider_connection_id', 'model_id', 'reasoning_effort'])
        .where('session_id', '=', sessionId)
        .execute()
      const seats = new Map(
        seatRows.map((row) => [
          row.agent_id,
          {
            providerConnectionId: row.provider_connection_id,
            modelId: row.model_id,
            reasoningEffort: row.reasoning_effort,
          },
        ]),
      )
      for (const { agentId, ...route } of routes) {
        if (seats.has(agentId)) await writeAgentRoute(trx, sessionId, agentId, route)
      }
      const next = recordModelChoices(
        parseModelChoices(owned.model_choices),
        seats,
        routes,
        new Date().toISOString(),
      )
      await trx
        .updateTable('agent_sessions')
        .set({ model_choices: JSON.stringify(next) })
        .where('id', '=', sessionId)
        .execute()
    }),
  )
}
