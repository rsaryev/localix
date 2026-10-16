import { reasoningForModel } from '@localixai/agent'
import { ApiError } from '../../../lib/errors'
import type { ModelRoute, SessionRecord } from '../repository'
import { sessionRoute } from '../session-route'
import type { SessionLifecycleCtx, UpdateSessionPatch } from './session-lifecycle-contracts'

/**
 * WHAT A SESSION PATCH SAYS ABOUT ROUTES — one participant (`route`) or several (`routes`).
 *
 * Both are checked before anything is written: a connection that no longer exists, or an agent
 * who is no longer seated, refuses the whole patch. A batch that wrote the members it could and
 * skipped the rest would leave the room half-moved while the client believes it moved.
 */
export async function assertRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'connectionExists'>,
  userId: string,
  session: Pick<SessionRecord, 'agents'>,
  patch: Pick<UpdateSessionPatch, 'route' | 'routes'>,
): Promise<void> {
  if (patch.route && patch.routes) {
    throw new ApiError(400, 'route_conflict', 'Send either one route or a batch of routes.')
  }
  const routes = patch.routes ?? (patch.route ? [patch.route] : [])
  if (patch.routes) {
    const ids = patch.routes.map((route) => route.agentId)
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(400, 'route_duplicate_agent', 'Each participant can be routed once.')
    }
  }
  const connections = new Set(
    routes.flatMap((route) => (route.providerConnectionId ? [route.providerConnectionId] : [])),
  )
  if (ctx.connectionExists) {
    for (const connectionId of connections) {
      if (!(await ctx.connectionExists(userId, connectionId))) {
        throw new ApiError(
          404,
          'provider_connection_not_found',
          'That provider connection no longer exists. Pick a provider in the model picker.',
        )
      }
    }
  }
  const seated = new Set(session.agents.map((agent) => agent.agentId))
  if (routes.some((route) => route.agentId && !seated.has(route.agentId))) {
    throw new ApiError(404, 'agent_unavailable', 'Selected agent is no longer a participant')
  }
}

/** Persist the route statement of a patch already checked by {@link assertRoutePatch}. */
export async function writeRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'repo'>,
  userId: string,
  id: string,
  session: Pick<SessionRecord, 'agents'>,
  patch: Pick<UpdateSessionPatch, 'route' | 'routes'>,
): Promise<void> {
  if (patch.routes) {
    // One transaction, never a loop of point writes: a failure halfway must move nobody.
    await ctx.repo.updateSessionAgentRoutes(userId, id, patch.routes)
    return
  }
  if (patch.route) {
    const target = patch.route.agentId ?? sessionRoute(session).agentId
    await ctx.repo.updateSessionAgentRoute(userId, id, target, patch.route)
  }
}

/**
 * The levels of a route patch, landed on what each target model offers — the rule the picker and
 * `/model` apply (`reasoning-levels.ts`), enforced here so a client cannot store a level its model
 * never receives. A level-only route is clamped against the seat's current model. A model the
 * catalog cannot resolve keeps the stated level: the runtime clamps it at request time.
 */
type RoutePatch = Pick<UpdateSessionPatch, 'route' | 'routes'>

export async function clampRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'reasoningModel'>,
  userId: string,
  session: Pick<SessionRecord, 'agents'>,
  patch: RoutePatch,
): Promise<RoutePatch> {
  const lookup = ctx.reasoningModel
  if (!lookup || (!patch.route && !patch.routes)) return patch
  const clamp = async <R extends { agentId?: string } & Partial<ModelRoute>>(route: R) => {
    if (!route.reasoningEffort) return route
    const seat = session.agents.find(
      (agent) => agent.agentId === (route.agentId ?? sessionRoute(session).agentId),
    )
    const modelId = route.modelId ?? seat?.modelId
    if (!modelId) return route
    const connectionId =
      route.providerConnectionId !== undefined
        ? route.providerConnectionId
        : (seat?.providerConnectionId ?? null)
    const model = await lookup(userId, connectionId, modelId)
    return model
      ? { ...route, reasoningEffort: reasoningForModel(route.reasoningEffort, model) }
      : route
  }
  return {
    ...patch,
    ...(patch.route ? { route: await clamp(patch.route) } : {}),
    ...(patch.routes ? { routes: await Promise.all(patch.routes.map(clamp)) } : {}),
  }
}
