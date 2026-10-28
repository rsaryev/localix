/**
 * WHERE A AGENT GETS ITS STARTING ROUTE.
 *
 * A route stores its model, connection and effort explicitly, and every reader takes it as
 * stored. This module supplies the sources `birthRoute` decides between — the user's last model
 * for an agent, the agent's card, the project, the per-model effort memory — for the moment a
 * route is decided: a session being born. A session stored without a model is not repaired
 * afterwards; a run on it stops with `NO_MODEL`.
 */
import type { AgentModelSettings } from '@localixai/agent'
import type { ReasoningEffort } from '../../../db/types'
import type { ModelRoute, RecentRoutes } from '../repository-types'
import { birthRoute, type StartingRoute } from '../agent-route-resolution'

export interface RouteDefaultsPorts {
  /** The project's configured model, if it has one. */
  loadProjectModelDefaults?: (
    userId: string,
    projectId: string,
  ) => Promise<Partial<ModelRoute> | null>
  /** The route on each agent's card, by agent ID, for the agents visible in this project. */
  loadAgentModelDefaults?: (
    userId: string,
    projectId: string | null,
  ) => Promise<Map<string, Partial<ModelRoute>>>
  /** The model the user last chose, per agent. */
  loadRecentRoutes?: (userId: string) => Promise<RecentRoutes>
  /** The per agent/model settings the picker writes — the effort memory. */
  loadAgentModelSettings?: (userId: string) => Promise<readonly AgentModelSettings[]>
}

const EMPTY_RECENT: RecentRoutes = { byAgent: new Map() }

/** The level last chosen for one agent on one model, from the picker's memory. */
export function rememberedEffort(
  settings: readonly AgentModelSettings[],
  agentId: string,
  modelId: string,
): ReasoningEffort | undefined {
  const matches = settings.filter(
    (entry) => entry.agentId === agentId && entry.modelId === modelId && entry.effort,
  )
  // A namespaced model id names its provider; prefer the entry recorded against it.
  const provider = modelId.includes('/') ? modelId.slice(0, modelId.indexOf('/')) : undefined
  const entry = matches.find((candidate) => candidate.providerId === provider) ?? matches[0]
  return entry?.effort as ReasoningEffort | undefined
}

/** Decide a new session's complete route. The one port every birth path is handed. */
export type StartingRouteFor = (
  userId: string,
  projectId: string | null,
  agentId: string,
  given?: { chosen?: Partial<ModelRoute> | null },
) => Promise<StartingRoute>

export function createRouteDefaults(ports: RouteDefaultsPorts) {
  /**
   * Read every source fresh: a route is decided once, when a session is born, so a stale copy
   * would only hide the model the person picked a moment ago.
   */
  const startingRoute: StartingRouteFor = async (userId, projectId, agentId, given) => {
    const [project, agents, recent, settings] = await Promise.all([
      projectId && ports.loadProjectModelDefaults
        ? ports.loadProjectModelDefaults(userId, projectId).catch(() => null)
        : null,
      ports.loadAgentModelDefaults
        ? ports.loadAgentModelDefaults(userId, projectId).catch(() => new Map())
        : new Map<string, Partial<ModelRoute>>(),
      ports.loadRecentRoutes
        ? ports.loadRecentRoutes(userId).catch(() => EMPTY_RECENT)
        : EMPTY_RECENT,
      ports.loadAgentModelSettings ? ports.loadAgentModelSettings(userId).catch(() => []) : [],
    ])
    return birthRoute({
      ...given,
      recentForAgent: recent.byAgent.get(agentId),
      agent: agents.get(agentId),
      project,
      effortForModel: (modelId) => rememberedEffort(settings, agentId, modelId),
    })
  }

  return { startingRoute }
}

export type RouteDefaults = ReturnType<typeof createRouteDefaults>
