import { withRoute } from '../session-route'
import { commandTarget } from './command-participant'
import { findCatalogModel } from '@localixai/agent/catalog'
import { readAgentSettings } from './agent-settings'
import { effortForModelSwitch } from './model-switch-effort'
import { rememberedEffort } from './session-route-defaults'
import { commandRemainder } from './slash-commands'
import type { ModelRoute, SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import type { ExistingMessages } from './run-agent'

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
 * Persist a route a slash command chose, through the picker's own choice writer
 * (`repository-model-choices.ts`): the seat and the session's choice for this agent together.
 *
 * `/model` re-routes ONE participant, so it says exactly that. Handing the
 * whole record to `updateSession` instead would state the whole party, and the record these
 * handlers hold was read with its routes already resolved — the other members' inherited models
 * would be written back as choices made here (see `writeMembership`).
 */
async function persistRoute(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  updated: SessionRecord,
  agentId: string,
  route: Partial<ModelRoute>,
): Promise<void> {
  await ctx.repo.updateSessionAgentRoutes(userId, sessionId, [{ agentId, ...route }])
  await ctx.repo.updateSession(userId, sessionId, { updatedAt: updated.updatedAt })
  ctx.publishSession(updated)
}

/**
 * Handles `/model [@handle] <query>`: fuzzy-matches a model available to the participant (scoped
 * to its provider connection if any) and switches THAT participant — the one named, or the one
 * the person's unaddressed words go to. Bare `/model` lists nothing: the composer offers the
 * picker's steps, which it completes through the picker's own writes (`useModelCommand`).
 */
export async function handleModelCommand(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  allMessages: ExistingMessages,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { deps, insertSystemNotice } = ctx
  const target = await commandTarget(
    session,
    allMessages,
    commandRemainder(prompt),
    ctx.runner.leadership(userId, session.projectId),
  )
  if (!target) return directReply('Choose an agent before changing its model.')
  const { participant } = target
  const arg = target.rest
  const catalog = await deps.catalogService.getCatalog()
  let available = catalog.models
  if (participant.providerConnectionId) {
    const conn = await deps.providerConnectionsService
      .requireConnection(userId, participant.providerConnectionId ?? '')
      .catch(() => null)
    // A deleted/re-added connection must not widen `/model` to every provider.
    // Recover the provider from the durable model selection when the stored id
    // has gone stale; the next run resolves the replacement live connection.
    const providerId =
      conn?.providerId ??
      (participant.modelId
        ? uniqueCatalogModelProvider(catalog.providers, catalog.models, participant.modelId)
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
  const settings = await readAgentSettings(deps.db, userId)
  const reasoningEffort = effortForModelSwitch({
    previous: participant,
    next: matched,
    remembered: rememberedEffort(
      settings?.agentModelSettings ?? [],
      participant.agentId,
      matched.id,
    ),
  })
  // `/model` re-routes ONE participant, never the whole conversation.
  const updated: SessionRecord = {
    ...withRoute(session, { modelId: matched.id, reasoningEffort }, participant.agentId),
    updatedAt: ts,
  }
  await persistRoute(ctx, userId, sessionId, updated, participant.agentId, {
    modelId: matched.id,
    reasoningEffort,
  })
  // The level moved with the model, so the agents hear it too: their context reduces each
  // participant's notices to the latest, and a stale level line would outlive the switch.
  const levelChanged = reasoningEffort !== participant.reasoningEffort
  const modelNotice = await insertSystemNotice(
    userId,
    sessionId,
    {
      kind: 'model_change',
      tone: 'neutral',
      participant: participant.handle,
      text: `${participant.handle} is now on ${shortModelName(matched.id)}.`,
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
      participant: participant.handle,
      text: `${participant.handle} reasoning effort set to ${reasoningEffort}.`,
    },
    ts,
    true,
  )
}
