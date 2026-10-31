import { agentRoute, withRoute } from '../../../../contracts/session-route'
/**
 * Resolve one session model and credential through the engine-neutral runtime ports.
 */
import { AgentRunError } from '@localixai/agent/agents'

import type { SessionRecord } from '../../repository'
import { resolveLanguageModel } from '../model-resolution'
import { diagnoseModelMiss } from '../model-resolution-miss'
import type { RunCatalog, RunEnv } from './types'
import type { RunTurnState } from './turn-state'

export async function resolveRunModel(args: {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId: string
  catalog: RunCatalog
  state: RunTurnState
}) {
  const { env, session, catalog, state } = args
  const { deps } = env
  const route = agentRoute(session)
  if (!route) {
    throw new AgentRunError(
      'AGENT_UNAVAILABLE',
      `Agent is no longer in the session: ${args.agentId}`,
    )
  }
  const resolved = await resolveLanguageModel({
    deps,
    userId: args.userId,
    modelId: route.modelId,
    preferredConnectionId: route.providerConnectionId,
    catalog,
  })
  if (!resolved) {
    // Name the step that failed: a vanished model, a provider with no enabled key and an
    // unloadable credential need three different fixes, and used to share one sentence.
    const { connections } = await deps.providerConnectionsService
      .listConnections(args.userId)
      .catch(() => ({ connections: [] }))
    const miss = diagnoseModelMiss({
      modelId: route.modelId,
      catalog,
      connections,
      preferredConnectionId: route.providerConnectionId,
    })
    throw new AgentRunError('NO_PROVIDER_CONNECTION', miss.message, { reason: miss.reason })
  }
  const {
    connection,
    credential,
    credentialId,
    credentialStore,
    entry: providerEntry,
    model,
    rawModelId,
  } = resolved
  state.usedKeyId = credentialId
  const providerId = providerEntry.id

  return {
    connection,
    credential,
    credentialId,
    credentialStore,
    model,
    providerEntry,
    providerId,
    rawModelId,
    effectiveModelId: route.modelId,
  }
}

export type ResolvedRunModel = Awaited<ReturnType<typeof resolveRunModel>>

/**
 * Record a recovered connection — but only when this conversation owns the model it serves.
 *
 * The run used to write the whole resolved route back, which froze an INHERITED route into
 * the session on the first turn: a model that had come from the project or the agent's card
 * became an explicit choice, and the chain never spoke for that session again
 * (`agent-route-resolution.ts`). A model that came from a level above has nothing durable to
 * record here — the connection belongs to the model that won, and the next run binds a live one
 * exactly as this one did.
 */
export async function persistReboundConnection(
  repo: {
    updateSessionAgentRoute: (
      userId: string,
      id: string,
      route: { providerConnectionId: string },
    ) => Promise<void>
  },
  userId: string,
  session: SessionRecord,
  providerConnectionId: string,
): Promise<void> {
  await repo.updateSessionAgentRoute(userId, session.id, { providerConnectionId })
}

/**
 * Project a provider-agnostic resolution back onto the session in memory: the recovered
 * connection belongs to the model that just resolved.
 */
export function rebindResolvedProvider(
  session: SessionRecord,
  providerConnectionId: string,
): SessionRecord {
  const current = agentRoute(session)
  if (!current) throw new AgentRunError('AGENT_UNAVAILABLE', 'The session has no agent.')
  return current.providerConnectionId === providerConnectionId
    ? session
    : withRoute(session, { providerConnectionId })
}
