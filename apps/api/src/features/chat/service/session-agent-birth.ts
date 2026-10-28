import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { StartingRouteFor } from './session-route-defaults'
import type { SessionAgentRoute, ModelRoute } from '../repository-types'
import {
  resolveSessionAgent,
  type ResolveSessionAgent,
  type ResolvedSessionAgent,
  type SessionAgentSelection,
} from './session-agent-selection'

/**
 * Who a NEW conversation is with, and what it starts on — the whole birth, in order: resolve the
 * requested agent, ask the model chain for its route, store it explicitly.
 *
 * One function because two births used it: a workspace session and an externally driven one.
 * The agent is fixed here for the life of the session; only its route changes afterwards
 * (`updateSessionAgentRoute`).
 */
export async function bornAgent(args: {
  userId: string
  projectId: string
  requested?: SessionAgentSelection & Partial<ModelRoute>
  explicit?: Partial<ModelRoute>
  parent?: { agent: SessionAgentRoute | null } | null
  /** Only a conversation requires a conversational agent; an engine's worker omits it. */
  host?: string
  resolve?: ResolveSessionAgent
  /** Decides a top-level session's complete route (`agent-route-resolution.ts`). */
  startingRoute?: StartingRouteFor
}): Promise<SessionAgentRoute> {
  const agent = await resolveSessionAgent({
    userId: args.userId,
    projectId: args.projectId,
    requested: args.requested,
    resolve: args.resolve,
    ...(args.host ? { host: args.host } : {}),
  })
  const explicit = args.explicit ?? {}
  // A child is an executable slice of its parent and snapshots the parent's route.
  if (args.parent || !args.startingRoute) {
    return seedAgent({ requested: agent, explicit, parent: args.parent ?? null })
  }
  return startingRouteFor(args.startingRoute, args.userId, args.projectId, agent, {
    chosen: chosenRoute(agent, explicit),
  })
}

/** What the caller explicitly asked for: the agent's own pick, else the session-wide one. */
function chosenRoute(
  agent: Partial<ModelRoute>,
  explicit: Partial<ModelRoute>,
): Partial<ModelRoute> {
  const effort = agent.reasoningEffort ?? explicit.reasoningEffort
  const model = agent.modelId
    ? { modelId: agent.modelId, providerConnectionId: agent.providerConnectionId ?? null }
    : explicit.modelId
      ? { modelId: explicit.modelId, providerConnectionId: explicit.providerConnectionId ?? null }
      : {}
  return { ...model, ...(effort ? { reasoningEffort: effort } : {}) }
}

/** The session's route, decided once and stored explicitly. */
export async function startingRouteFor(
  startingRoute: StartingRouteFor,
  userId: string,
  projectId: string | null,
  agent: ResolvedSessionAgent,
  given: { chosen?: Partial<ModelRoute> | null },
): Promise<SessionAgentRoute> {
  const {
    providerConnectionId: _connection,
    modelId: _model,
    reasoningEffort: _effort,
    ...identity
  } = agent as ResolvedSessionAgent & Partial<ModelRoute>
  const route = await startingRoute(userId, projectId, agent.agentId, given)
  return {
    ...identity,
    providerConnectionId: route.providerConnectionId,
    modelId: route.modelId,
    reasoningEffort: route.reasoningEffort,
    modelOrigin: route.modelOrigin,
  }
}

/**
 * Seed the route at birth.
 *
 * The agent has already been resolved by the host. Its own route choice overrides the caller's
 * session-wide one. A top-level session with no choice stays blank so the model chain remains
 * live. A child inherits its parent's effective route: a conversation already running on a model
 * must not create a model-less child.
 *
 * THE EFFORT is written now, concretely. It is the dial for the task this conversation is about,
 * so it must not move under a running conversation when a level below it changes. A child takes
 * its parent's: it is a slice of its parent's task, and a flat default silently downgraded every
 * `Agent` child of a high-effort run.
 */
export function seedAgent(args: {
  requested: ResolvedSessionAgent
  explicit: Partial<ModelRoute>
  parent?: { agent: SessionAgentRoute | null } | null
}): SessionAgentRoute {
  const { requested, explicit: input, parent } = args
  const parentRoute = parent?.agent ?? null
  const {
    providerConnectionId: agentConnectionId,
    modelId: agentModelId,
    reasoningEffort: agentEffort,
    ...identity
  } = requested
  const agentStatesModel = Boolean(agentModelId)
  const inputStatesModel = !agentStatesModel && Boolean(input.modelId)
  const inheritedModel =
    !agentStatesModel && !inputStatesModel && parentRoute?.modelId ? parentRoute : null
  return {
    providerConnectionId: agentStatesModel
      ? (agentConnectionId ?? null)
      : inputStatesModel
        ? (input.providerConnectionId ?? null)
        : (inheritedModel?.providerConnectionId ?? null),
    modelId: agentStatesModel
      ? agentModelId!
      : inputStatesModel
        ? input.modelId!
        : (inheritedModel?.modelId ?? ''),
    ...(inheritedModel ? { modelOrigin: 'primary' as const } : {}),
    reasoningEffort:
      agentEffort ??
      input.reasoningEffort ??
      parentRoute?.reasoningEffort ??
      DEFAULT_REASONING_EFFORT,
    ...identity,
  }
}
