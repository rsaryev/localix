import { agentModelSettingsFor, type AgentModelSettings } from '@localixai/agent'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import { reasoningOnModel } from '../../../model/modelReasoning'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { ConversationAgentRow } from '../model-select/ModelTaskColumn'
import { agentSlot } from '../model-select/agentSlot'
import { resolveLiveTaskModel, type ModelRoutingSlot } from '../model-select/taskReasoning'

/**
 * Everything `/model` reads to offer the picker's columns as steps. The same inputs the picker
 * has: the conversation's agent as its workload column draws it, the connections in its
 * provider-column order, the catalog, and the per-agent model settings in user settings.
 */
export interface ModelCommandContext {
  /** The conversation's agent; absent before the registry has answered. */
  agent: ConversationAgentRow | undefined
  /** Ordered as the picker's provider column orders them (most popular first). */
  connections: readonly { id: string; providerId: string; label: string }[]
  models: readonly CatalogModel[]
  sessionConnectionId: string | null
  agentModelSettings?: readonly AgentModelSettings[]
  /** The person's turns-per-message default (`agentSettings.maxTurns`). */
  maxTurns?: number
}

/** The route the agent runs on now. */
export function targetSlot(context: ModelCommandContext): ModelRoutingSlot {
  return agentSlot(context.agent, context.sessionConnectionId)
}

/** The catalog model a connection offers under this id, as the picker resolves a pick. */
export function connectionModel(
  context: ModelCommandContext,
  connectionId: string | undefined,
  modelId: string | undefined,
): CatalogModel | undefined {
  return findCatalogModelForConnection(
    context.models as CatalogModel[],
    context.connections,
    connectionId,
    modelId,
  )
}

/**
 * The level a pick of `model` starts at for the agent — the picker's `reasoningFor`: the running
 * model keeps (clamps) the agent's level; any other model starts at the level last chosen for
 * this agent on it, else its default.
 */
export function startReasoning(context: ModelCommandContext, model: CatalogModel): ReasoningEffort {
  const slot = targetSlot(context)
  const live = resolveLiveTaskModel(context.models, context.connections, slot)
  const current = live?.model.id === model.id && live.model.providerId === model.providerId
  const running = current ? (slot?.reasoningEffort as ReasoningEffort | undefined) : undefined
  const saved = context.agent
    ? agentModelSettingsFor(
        context.agentModelSettings,
        context.agent.agentId,
        model.providerId,
        model.id,
      )?.effort
    : undefined
  return reasoningOnModel(model, running, saved)
}
