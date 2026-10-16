import { agentModelSettingsFor, type AgentModelSettings } from '@localixai/agent'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import { reasoningOnModel } from '../../../model/modelReasoning'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { ParticipantRow } from '../model-select/ModelTaskColumn'
import { participantSlot } from '../model-select/participantSlot'
import { summarizeParty } from '../model-select/partyRoute'
import { resolveLiveTaskModel, type ModelRoutingSlot } from '../model-select/taskReasoning'

/** The value the agent step commits for the picker's "All agents" row. */
export const ALL_AGENTS = 'all'

/**
 * Everything `/model` reads to offer the picker's columns as steps. The same inputs the picker
 * has: the room as its Agents column draws it, the connections in its provider-column order, the
 * catalog, and the per-agent model settings in user settings.
 */
export interface ModelCommandContext {
  /** The picker's Agents column: the participants, then the agents that could join. */
  participants: readonly ParticipantRow[]
  /** Ordered as the picker's provider column orders them (OAuth first). */
  connections: readonly { id: string; providerId: string; label: string }[]
  models: readonly CatalogModel[]
  sessionConnectionId: string | null
  agentModelSettings?: readonly AgentModelSettings[]
  /** The person's turns-per-message default (`agentSettings.maxTurns`). */
  maxTurns?: number
}

export type ModelCommandTarget =
  | { kind: 'agent'; member: ParticipantRow }
  | { kind: 'party'; members: readonly ParticipantRow[] }

/**
 * Is the agent step shown? Wherever there is an agent to list, as in the picker: "All agents" is
 * always offered — one agent included — because it is also what agents invited later join on.
 */
export const hasAgentStep = (context: ModelCommandContext) => context.participants.length > 0

/** Whom the command configures: the chosen agent (invited or not), or every listed agent. */
export function commandTarget(
  context: ModelCommandContext,
  agentValue: string | undefined,
): ModelCommandTarget | null {
  const { participants } = context
  if (agentValue === ALL_AGENTS) return { kind: 'party', members: participants }
  const handle = agentValue?.replace(/^@/, '').toLowerCase()
  const member = participants.find((row) => row.handle.toLowerCase() === handle)
  return member ? { kind: 'agent', member } : null
}

/** The route the target runs on now: a member's seat, or the room's shared model when it has one. */
export function targetSlot(
  context: ModelCommandContext,
  target: ModelCommandTarget,
): ModelRoutingSlot {
  return target.kind === 'party'
    ? summarizeParty(target.members, context.sessionConnectionId).slot
    : participantSlot(context.participants, target.member.agentId, context.sessionConnectionId)
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
 * The level a pick of `model` starts at for this target — the picker's `reasoningFor`: the
 * running model keeps (clamps) the target's level; any other model starts at the level last chosen
 * for this agent on it, else its default. The room has no memory of its own, so "All agents"
 * starts a new model at its default.
 */
export function startReasoning(
  context: ModelCommandContext,
  target: ModelCommandTarget,
  model: CatalogModel,
): ReasoningEffort {
  const slot = targetSlot(context, target)
  const live = resolveLiveTaskModel(context.models, context.connections, slot)
  const current = live?.model.id === model.id && live.model.providerId === model.providerId
  const running = current ? (slot?.reasoningEffort as ReasoningEffort | undefined) : undefined
  const saved =
    target.kind === 'agent'
      ? agentModelSettingsFor(
          context.agentModelSettings,
          target.member.agentId,
          model.providerId,
          model.id,
        )?.effort
      : undefined
  return reasoningOnModel(model, running, saved)
}
