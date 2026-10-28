import { sql, type Kysely } from 'kysely'

import type { AppDatabase, ReasoningEffort } from '../../db'
import type { SessionAgentRoute, ModelRoute } from './repository-types'

/**
 * A session's one agent and the route its turns run on: columns of `agent_sessions`.
 *
 * The agent is chosen when the session is created and never changes; only its route (model,
 * connection, reasoning level) does, through {@link writeAgentRoute}.
 */

/** The agent columns of a session row, as the mapper reads them. */
export interface SessionAgentColumns {
  agent_id?: string | null
  agent_name?: string | null
  provider_connection_id?: string | null
  model_id?: string | null
  reasoning_effort?: ReasoningEffort | null
}

/** The agent of a stored row. A row without one (a log that runs no model) has none. */
export function agentFromRow(row: SessionAgentColumns): SessionAgentRoute | null {
  if (!row.agent_id || !row.agent_name) return null
  return {
    agentId: row.agent_id,
    name: row.agent_name,
    providerConnectionId: row.provider_connection_id ?? null,
    modelId: row.model_id ?? '',
    reasoningEffort: row.reasoning_effort ?? 'medium',
  }
}

const nowStamp = sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

/** The columns an insert writes for a session's agent. */
export function agentColumns(route: SessionAgentRoute | null) {
  // Only an explicit choice teaches "your last model for this agent". A route filled from a
  // default (card, project, primary, last model) is stored but is nobody's new decision.
  const chosen = Boolean(route?.modelId) && (route?.modelOrigin ?? 'session') === 'session'
  return {
    agent_id: route?.agentId ?? null,
    agent_name: route?.name ?? null,
    provider_connection_id: route?.providerConnectionId ?? null,
    model_id: route?.modelId ?? '',
    reasoning_effort: route?.reasoningEffort ?? 'medium',
    model_selected_at: chosen ? nowStamp : null,
    reasoning_selected_at: chosen ? nowStamp : null,
  }
}

/** Reject a session born without a resolved agent identity. */
export function assertResolvedAgent(route: SessionAgentRoute | null): void {
  if (route && (!route.agentId || !route.name)) {
    throw new Error('A session requires a resolved agent identity')
  }
}

/**
 * Point-update the session agent's route.
 *
 * This is what the model picker calls. A session record handed out by the repository carries a
 * RESOLVED route — the model chain has already filled each blank from the project, the agent's
 * card or the last route the user chose — so a writer that re-states the record it just read
 * would write inherited values back as if the user had chosen them. Only the fields named in
 * `route` are written.
 */
export async function writeAgentRoute(
  db: Kysely<AppDatabase>,
  sessionId: string,
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
          ...(stamp ? { model_selected_at: route.modelId ? nowStamp : null } : {}),
        }
      : {}),
    ...(route.reasoningEffort !== undefined
      ? {
          reasoning_effort: route.reasoningEffort,
          ...(stamp ? { reasoning_selected_at: nowStamp } : {}),
        }
      : {}),
  }
  if (Object.keys(patch).length === 0) return
  await db.updateTable('agent_sessions').set(patch).where('id', '=', sessionId).execute()
}

/** The route columns of a narrow projection → the domain shape. */
export function routeFromRow(row: {
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
