import { sessionRoute, withRoute } from '../../../contracts/session-route'
import { findCatalogModel } from '@localixai/agent/catalog'
import { readAgentSettings } from './agent-settings'
import { effortForModelSwitch } from './model-switch-effort'
import { rememberedEffort } from './session-route-defaults'
import { commandRemainder } from './slash-commands'
import type { ModelRoute, SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { announceModelSwitches, modelSwitchRefusal } from './cc-session-events'

/** The slice of {@link CommandHandlerContext} the session-setting commands need. */
type SettingCommandContext = Pick<
  CommandHandlerContext,
  'deps' | 'repo' | 'runner' | 'publishSession' | 'runAgent' | 'insertSystemNotice'
>

function shortModelName(modelId: string): string {
  const parts = modelId.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelId
}

/** Recover a deleted connection's provider only from an unambiguous model owner. */
export function uniqueCatalogModelProvider(
  providers: readonly { id: string }[],
  models: readonly { id: string; providerId: string }[],
  modelId: string,
): string | null {
  // `findCatalogModel(..., null, ...)` already implements the shared catalog
  // rule: provider-prefixed ids resolve directly, while a bare id resolves only
  // when exactly one provider owns it.
  const model = findCatalogModel(models, null, modelId)
  return model && providers.some((provider) => provider.id === model.providerId)
    ? model.providerId
    : null
}

/**
 * Persist a route a slash command chose. Only the named route fields are written: the record
 * these handlers hold was read with its route already resolved, so handing it whole to
 * `updateSession` would write inherited values back as choices made here.
 */
async function persistRoute(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  updated: SessionRecord,
  route: Partial<ModelRoute>,
): Promise<void> {
  await ctx.repo.updateSessionAgentRoute(userId, sessionId, route)
  await ctx.repo.updateSession(userId, sessionId, { updatedAt: updated.updatedAt })
  ctx.publishSession(updated)
}

/**
 * Handles `/model <query>`: fuzzy-matches a model available to the session's agent (scoped to
 * its provider connection if any) and switches it. Bare `/model` lists nothing: the composer offers the
 * picker's steps, which it completes through the picker's own writes (`useModelCommand`).
 */
export async function handleModelCommand(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { deps, insertSystemNotice } = ctx
  if (!session.agent) return directReply('Choose an agent before changing its model.')
  const route = sessionRoute(session)
  const arg = commandRemainder(prompt).trim()
  const catalog = await deps.catalogService.getCatalog()
  let available = catalog.models
  if (route.providerConnectionId) {
    const conn = await deps.providerConnectionsService
      .requireConnection(userId, route.providerConnectionId ?? '')
      .catch(() => null)
    // A deleted/re-added connection must not widen `/model` to every provider.
    // Recover the provider from the durable model selection when the stored id
    // has gone stale; the next run resolves the replacement live connection.
    const providerId =
      conn?.providerId ??
      (route.modelId
        ? uniqueCatalogModelProvider(catalog.providers, catalog.models, route.modelId)
        : null)
    // A stored connection means `/model` is provider-scoped. If its provider
    // cannot be recovered uniquely, showing every provider would let a command
    // silently cross the durable route that runtime itself now rejects.
    available = providerId ? catalog.models.filter((m) => m.providerId === providerId) : []
  }
  // `/model` switches; it never prints the catalog. The composer walks the picker's steps
  // (agent → provider → model → settings); a surface without them names the model.
  if (!arg) {
    return directReply(
      'Pick the agent, provider and model in the `/model` steps, or name one: `/model <name>`.',
    )
  }
  const q = arg.toLowerCase()
  const matches = available.filter(
    (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
  )
  const exact = matches.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q)
  const matched = exact ?? (matches.length === 1 ? matches[0] : undefined)
  if (!matched) {
    const reply =
      matches.length === 0
        ? `No model matching "${arg}". Pick one in the \`/model\` steps or the model picker.`
        : `Multiple models match "${arg}" — be more specific:\n\n${matches
            .slice(0, 10)
            .map((m) => `- \`${m.name}\``)
            .join('\n')}`
    return directReply(reply)
  }
  // The level follows the model, as it does in the picker: the previous model's level never
  // carries over, and the stored level is one this model offers.
  const settings = await readAgentSettings(deps.ports.userProfileRepo, userId)
  const reasoningEffort = effortForModelSwitch({
    previous: route,
    next: matched,
    remembered: rememberedEffort(settings?.agentModelSettings ?? [], route.agentId, matched.id),
  })
  // CC PreModelSwitch may keep the current model; PostModelSwitch follows the write.
  const switches =
    matched.id === route.modelId
      ? []
      : [{ fromModel: route.modelId, toModel: matched.id, requestedModel: arg }]
  const refusal = await modelSwitchRefusal(
    ctx.runner.ccHookSessions,
    sessionId,
    switches,
    'command',
  )
  if (refusal) return directReply(`The model stays ${shortModelName(route.modelId)}: ${refusal}`)
  // `/model` re-routes the session's agent.
  const updated: SessionRecord = {
    ...withRoute(session, { modelId: matched.id, reasoningEffort }),
    updatedAt: ts,
  }
  await persistRoute(ctx, userId, sessionId, updated, {
    modelId: matched.id,
    reasoningEffort,
  })
  announceModelSwitches(ctx.runner.ccHookSessions, sessionId, switches, 'command')
  // The level moved with the model, so the agents hear it too: their context reduces each
  // agent's notices to the latest, and a stale level line would outlive the switch.
  const levelChanged = reasoningEffort !== route.reasoningEffort
  const modelNotice = await insertSystemNotice(
    userId,
    sessionId,
    {
      kind: 'model_change',
      tone: 'neutral',
      text: `${route.name} is now on ${shortModelName(matched.id)}.`,
      detail: matched.name,
    },
    ts,
    !levelChanged,
  )
  if (!levelChanged) return modelNotice
  return insertSystemNotice(
    userId,
    sessionId,
    {
      kind: 'reasoning_change',
      tone: 'neutral',
      text: `${route.name} reasoning effort set to ${reasoningEffort}.`,
    },
    ts,
    true,
  )
}
