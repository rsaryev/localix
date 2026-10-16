import { sql, type Kysely } from 'kysely'

import type { AppDatabase, ReasoningEffort } from '../../db'
import { safeJsonParse } from '../../lib/json'
import type { SessionAgentRoute, ModelRoute } from './repository-types'

/**
 * Reading and writing a conversation's participants — who is in it, and what each of them runs on.
 *
 * WHY THE READ IS A SUBQUERY AND NOT A JOIN. Every session read in this repository projects
 * ONE row per session, and a join to a one-to-many table turns that into N rows the mapper
 * would have to re-group. Aggregating the participants to JSON inside the select keeps the row
 * shape the mapper already expects, keeps a list of 200 sessions one statement rather than 201,
 * and keeps the ORDER of the participants — which is speaking order — decided by SQL rather than
 * by whatever order rows happened to come back in.
 */

/** Columns of `conversation_participants` as the participants JSON names them. */
const PARTICIPANT_FIELDS = sql`json_object(
  'agentId', participant.agent_id,
  'handle', participant.handle,
  'providerConnectionId', participant.provider_connection_id,
  'modelId', participant.model_id,
  'reasoningEffort', participant.reasoning_effort
)`

/**
 * The participants of `agent_sessions.id`, as a JSON array ordered by join position.
 *
 * The inner ORDER BY is inside a subquery on purpose: `json_group_array` preserves the order
 * of the rows it is fed, and SQLite only guarantees that order when the feed is itself ordered.
 */
export const participantsJsonFor = (sessionIdColumn: string) => sql<string>`(
  SELECT json_group_array(${PARTICIPANT_FIELDS})
  FROM (
    SELECT * FROM conversation_participants
    WHERE conversation_participants.session_id = ${sql.ref(sessionIdColumn)}
    ORDER BY conversation_participants."position"
  ) AS participant
)`

/** The participants of the unaliased `agent_sessions` table, which is how most reads spell it. */
export const participantsJsonColumn = participantsJsonFor('agent_sessions.id')

/**
 * Invalid stored membership remains readable as unavailable. Execution rejects an empty
 * conversation; reading never substitutes a different identity for a corrupt or missing one.
 */
export function parseParticipants(raw: string | null | undefined): SessionAgentRoute[] {
  const parsed = safeJsonParse<unknown>(raw)
  const rows = Array.isArray(parsed) ? parsed.flatMap(toRoute) : []
  // Malformed membership is unavailable, never a replacement with the default agent.
  return rows.length === (Array.isArray(parsed) ? parsed.length : 0) ? rows : []
}

function toRoute(value: unknown): SessionAgentRoute[] {
  if (typeof value !== 'object' || value === null) return []
  const row = value as Record<string, unknown>
  if (typeof row.agentId !== 'string' || !row.agentId) return []
  if (typeof row.handle !== 'string' || !row.handle) return []
  return [
    {
      agentId: row.agentId,
      handle: row.handle,
      providerConnectionId:
        typeof row.providerConnectionId === 'string' ? row.providerConnectionId : null,
      modelId: typeof row.modelId === 'string' ? row.modelId : '',
      reasoningEffort: (typeof row.reasoningEffort === 'string'
        ? row.reasoningEffort
        : 'medium') as ReasoningEffort,
    },
  ]
}

/** A participant row exactly as it is stored, built once for both writers. */
const participantRows = (sessionId: string, participants: readonly SessionAgentRoute[]) =>
  participants.map((route, position) => ({
    session_id: sessionId,
    agent_id: route.agentId,
    handle: route.handle,
    position,
    provider_connection_id: route.providerConnectionId,
    model_id: route.modelId,
    // Only an explicit choice teaches "your last model for this agent". A route filled from a
    // default (card, project, primary, last model) is stored but is nobody's new decision.
    model_selected_at:
      route.modelId && (route.modelOrigin ?? 'session') === 'session'
        ? sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
        : null,
    reasoning_effort: route.reasoningEffort,
    reasoning_selected_at:
      route.modelId && (route.modelOrigin ?? 'session') === 'session'
        ? sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
        : null,
  }))

const assertDistinctParticipants = (participants: readonly SessionAgentRoute[]): void => {
  if (participants.some((route) => !route.agentId || !route.handle)) {
    throw new Error('A session requires resolved agent identities')
  }
  // Stated here rather than left to the primary key. The membership writer upserts, so a list
  // naming the same agent twice would be accepted by the database — the second row would simply
  // overwrite the first one's position — and a caller that built a malformed list would get a
  // silently reordered conversation instead of a refusal.
  if (new Set(participants.map((route) => route.agentId)).size !== participants.length) {
    throw new Error('A session cannot seat the same agent twice')
  }
}

/**
 * State a conversation's whole membership AND what each participant runs on. BIRTH ONLY.
 *
 * Only a creation may state routes wholesale, because only a creation knows that every value it
 * holds was actually chosen. Every later write goes through {@link writeMembership} or
 * {@link writeAgentRoute}; see the warning there for what wholesale replacement cost us.
 */
export async function writeParticipants(
  db: Kysely<AppDatabase>,
  sessionId: string,
  participants: readonly SessionAgentRoute[],
): Promise<void> {
  assertDistinctParticipants(participants)
  await db.deleteFrom('conversation_participants').where('session_id', '=', sessionId).execute()
  await db
    .insertInto('conversation_participants')
    .values(participantRows(sessionId, participants))
    .execute()
}

/**
 * Change WHO is in the conversation, and nothing about what the people who stay run on.
 *
 * The route columns of a surviving member are deliberately not in the `DO UPDATE` list, and
 * that omission is the whole point of this function. A session record handed out by the
 * repository carries RESOLVED routes — the model chain has already filled each blank from the
 * project, the agent's card or the last route the user chose (`session-route-defaults.ts`) — so
 * a writer that re-states the membership it just read writes those inherited values back as if
 * the user had chosen them. That is how a rename, a pin, an archive or the first turn's
 * connection rebind each used to freeze a conversation onto whatever it happened to inherit: the
 * route stopped being blank, so every level below the session stopped being consulted, and a
 * project default changed later reached nothing.
 *
 * A newcomer's row is inserted with whatever the caller seeded it with, which is a genuine
 * statement: joining IS the moment that participant's route is decided.
 */
export async function writeMembership(
  db: Kysely<AppDatabase>,
  sessionId: string,
  participants: readonly SessionAgentRoute[],
): Promise<void> {
  assertDistinctParticipants(participants)
  await db
    .deleteFrom('conversation_participants')
    .where('session_id', '=', sessionId)
    .where(
      'agent_id',
      'not in',
      participants.map((route) => route.agentId),
    )
    .execute()
  await db
    .insertInto('conversation_participants')
    .values(participantRows(sessionId, participants))
    .onConflict((conflict) =>
      conflict.columns(['session_id', 'agent_id']).doUpdateSet((eb) => ({
        handle: eb.ref('excluded.handle'),
        position: eb.ref('excluded.position'),
      })),
    )
    .execute()
}

/**
 * Point-update one participant's route, leaving the rest of the conversation alone.
 *
 * This is what the model picker calls: the user changed the model for ONE agent in this
 * conversation. A no-op when the agent is not a participant — picking a model for someone who
 * is not in the conversation is a stale UI, not a reason to add them to it.
 */
export async function writeAgentRoute(
  db: Kysely<AppDatabase>,
  sessionId: string,
  agentId: string,
  route: Partial<ModelRoute>,
  /** A default filled in, not a choice: it must not teach "your last model" anything. */
  opts?: { seeded?: boolean },
): Promise<void> {
  const stamp = !opts?.seeded
  const patch = {
    ...(route.providerConnectionId !== undefined
      ? { provider_connection_id: route.providerConnectionId }
      : {}),
    ...(route.modelId !== undefined
      ? {
          model_id: route.modelId,
          // A model without an explicit connection must bind afresh. Keeping the previous
          // model's connection makes the read model claim a pair nobody selected.
          ...(route.providerConnectionId === undefined ? { provider_connection_id: null } : {}),
          ...(stamp
            ? {
                model_selected_at: route.modelId
                  ? sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
                  : null,
              }
            : {}),
        }
      : {}),
    ...(route.reasoningEffort !== undefined
      ? {
          reasoning_effort: route.reasoningEffort,
          ...(stamp
            ? { reasoning_selected_at: sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` }
            : {}),
        }
      : {}),
  }
  if (Object.keys(patch).length === 0) return
  await db
    .updateTable('conversation_participants')
    .set(patch)
    .where('session_id', '=', sessionId)
    .where('agent_id', '=', agentId)
    .execute()
}

/**
 * A route row joined onto a narrow projection → the domain shape.
 *
 * The wide session reads take all participants as JSON; the hot, column-picking reads want
 * three values and nothing else — the auxiliary model lookup runs before every inline
 * completion. Those LEFT-join `conversation_participants`
 * at position 0 and pass the row here. A missing join is not an error, for the same reason
 * {@link parseParticipants} tolerates an empty conversation.
 */
export function routeFromJoin(row: {
  provider_connection_id?: string | null
  model_id?: string | null
  reasoning_effort?: ReasoningEffort | null
}): ModelRoute {
  return {
    providerConnectionId: row.provider_connection_id ?? null,
    modelId: row.model_id ?? '',
    reasoningEffort: row.reasoning_effort ?? 'medium',
  }
}
