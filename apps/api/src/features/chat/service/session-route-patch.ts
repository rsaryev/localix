import { reasoningForModel } from '@localixai/agent'
import { ApiError } from '../../../lib/errors'
import type { SessionRecord } from '../repository'
import { sessionRoute } from '../../../contracts/session-route'
import type { SessionLifecycleCtx, UpdateSessionPatch } from './session-lifecycle-contracts'

/**
 * WHAT A SESSION PATCH SAYS ABOUT THE MODEL — one route for the session's agent.
 *
 * It is checked before anything is written: a connection that no longer exists refuses the whole
 * patch.
 */
export async function assertRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'connectionExists'>,
  userId: string,
  patch: Pick<UpdateSessionPatch, 'route'>,
): Promise<void> {
  const connectionId = patch.route?.providerConnectionId
  if (connectionId && ctx.connectionExists && !(await ctx.connectionExists(userId, connectionId))) {
    throw new ApiError(
      404,
      'provider_connection_not_found',
      'That provider connection no longer exists. Pick a provider in the model picker.',
    )
  }
}

/**
 * Persist the model statement of a patch already checked by {@link assertRoutePatch} through
 * the one writer `/model` uses too.
 */
export async function writeRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'repo'>,
  userId: string,
  id: string,
  patch: Pick<UpdateSessionPatch, 'route'>,
): Promise<void> {
  if (patch.route) await ctx.repo.updateSessionAgentRoute(userId, id, patch.route)
}

/**
 * The level of a route patch, landed on what the target model offers — the rule the picker and
 * `/model` apply (`reasoning-levels.ts`), enforced here so a client cannot store a level its
 * model never receives. A level-only route is clamped against the session's current model. A
 * model the catalog cannot resolve keeps the stated level: the runtime clamps it at request time.
 */
type RoutePatch = Pick<UpdateSessionPatch, 'route'>

export async function clampRoutePatch(
  ctx: Pick<SessionLifecycleCtx, 'reasoningModel'>,
  userId: string,
  session: Pick<SessionRecord, 'agent'>,
  patch: RoutePatch,
): Promise<RoutePatch> {
  const lookup = ctx.reasoningModel
  const route = patch.route
  if (!lookup || !route?.reasoningEffort) return patch
  const current = sessionRoute(session)
  const modelId = route.modelId ?? current.modelId
  if (!modelId) return patch
  const connectionId =
    route.providerConnectionId !== undefined
      ? route.providerConnectionId
      : current.providerConnectionId
  const model = await lookup(userId, connectionId, modelId)
  return model
    ? { route: { ...route, reasoningEffort: reasoningForModel(route.reasoningEffort, model) } }
    : patch
}
