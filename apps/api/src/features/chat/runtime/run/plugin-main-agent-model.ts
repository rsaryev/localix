import { agentModelSettingsFor } from '@localixai/agent'
import { findCatalogModel } from '@localixai/agent/catalog'

import { agentRoute, withRoute } from '../../../../contracts/session-route'
import { agentModelRoute } from '../../../agent-core/agent-model-route'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import { toSessionSummary } from '../../repository'
import { resolveRunModel } from './model-selection'
import type { RunFrame } from './stages/frame'
import type { ResolvedTurn } from './stages/turn'

/**
 * The model a plugin's main agent asks for, when it should win: Claude Code runs the main thread on
 * the `agent` setting's model unless the person chose one. Here the person's choice is the seat's
 * own pick for this chat — a default the seat was born with (the agent's card, the project, the
 * last model used) is not one. `inherit`, no model, or the seat's own model change nothing.
 */
export function pluginAgentModelFor(input: {
  declared: string | undefined
  seatModelId: string
  seatChosen: boolean
  catalog: readonly { id: string; providerId: string }[]
}): string | null {
  if (input.seatChosen || !input.declared) return null
  const resolved = agentModelRoute(
    { model: input.declared },
    { catalog: input.catalog, inherit: input.seatModelId },
  ).route.modelId
  return resolved && resolved !== input.seatModelId ? resolved : null
}

/**
 * Run the main-agent chat on its plugin agent's model (`settings.json` → `agent` → `model:`).
 *
 * Plugins load after the turn chose its model, so the turn is re-pointed here, before anything
 * prices, budgets or calls on it, and the seat records the model as a default (not a pick): the
 * picker shows what the chat runs on, the next turn starts on it, and the person's own pick later
 * still wins. A model with no live connection leaves the seat's model in place.
 */
export async function adoptPluginAgentModel(
  frame: RunFrame,
  turn: ResolvedTurn,
  mainAgent: LoadedPluginAgent | null,
): Promise<void> {
  if (!mainAgent?.preferredModel) return
  const { env, userId, speakerAgentId } = frame
  const seat = agentRoute(frame.session, speakerAgentId)
  if (!seat) return
  const modelId = pluginAgentModelFor({
    declared: mainAgent.preferredModel,
    seatModelId: seat.modelId,
    seatChosen: await env.repo.isSeatModelChosen(userId, frame.session.id, speakerAgentId),
    catalog: turn.catalog.models,
  })
  if (!modelId) return
  // The seat's connection is the hint: a model id several providers list resolves on the account
  // the chat already uses when that account serves it, and on the model's own provider otherwise.
  const session = withRoute(
    frame.session,
    { modelId, providerConnectionId: seat.providerConnectionId },
    seat.agentId,
  )
  const model = await resolveRunModel({
    env,
    userId,
    session,
    agentId: speakerAgentId,
    state: turn.state,
    catalog: turn.catalog,
  }).catch((error: unknown) => {
    env.deps.logger?.warn(
      `plugin agent "${mainAgent.fullName}" asks for model "${modelId}", which cannot run`,
      { error },
    )
    return null
  })
  if (!model) return

  const rebound = withRoute(session, { providerConnectionId: model.connection.id }, seat.agentId)
  await env.repo.updateSessionAgentRoute(
    userId,
    rebound.id,
    seat.agentId,
    { modelId, providerConnectionId: model.connection.id },
    { seeded: true },
  )
  frame.session = rebound
  frame.speakerRoute = agentRoute(rebound, speakerAgentId)!
  frame.runtimeSession = withRoute(
    frame.runtimeSession,
    { modelId, providerConnectionId: model.connection.id },
    seat.agentId,
  )
  env.state.activeRunSessions.set(rebound.id, {
    userId,
    session: frame.runtimeSession,
    agentId: speakerAgentId,
  })
  const catalogModel = findCatalogModel(turn.catalog.models, model.providerId, modelId)
  Object.assign(turn, {
    model,
    catalogModel,
    modelCost: catalogModel?.cost,
    contextLimit: agentModelSettingsFor(
      turn.globalAgentSettings?.agentModelSettings,
      speakerAgentId,
      model.providerId,
      catalogModel?.id ?? modelId,
    )?.contextLimit,
    modelInput: catalogModel?.inputModalities as readonly string[] | undefined,
  })
  env.deps.streamRegistry.publish(userId, rebound.id, {
    type: 'session.updated',
    session: toSessionSummary(frame.runtimeSession),
  })
}
