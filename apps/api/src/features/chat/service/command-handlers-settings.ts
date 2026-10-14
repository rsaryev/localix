import { withRoute } from '../session-route'
import { commandTarget } from './command-participant'
import { REASONING_EFFORTS, type ReasoningEffort } from '../../../db/types'
import { findCatalogModel } from '@localixai/agent/catalog'
import { formatModelList } from './model-list'
import { commandRemainder, splitCommandArg } from './slash-commands'
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
 * Persist a route a slash command chose, as the point write it is.
 *
 * `/model` and `/reasoning` re-route ONE participant, so they say exactly that. Handing the
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
  await ctx.repo.updateSessionAgentRoute(userId, sessionId, agentId, route)
  await ctx.repo.updateSession(userId, sessionId, { updatedAt: updated.updatedAt })
  ctx.publishSession(updated)
}

/**
 * Shared tail of the session-setting commands: persist the chosen route, publish
 * `session.updated`, then either run a trailing task immediately (when one followed the
 * command) or reply with the confirmation note.
 */
async function persistSettingAndContinue(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  updated: SessionRecord,
  agentId: string,
  route: Partial<ModelRoute>,
  allMessages: ExistingMessages,
  rest: string,
  ts: string,
  notice: Parameters<SettingCommandContext['insertSystemNotice']>[2],
  command: string,
  label: string,
): Promise<MessageMutationResponse> {
  const { runAgent, insertSystemNotice } = ctx
  await persistRoute(ctx, userId, sessionId, updated, agentId, route)
  if (!rest) return insertSystemNotice(userId, sessionId, notice, ts, true)

  // The notice lands immediately before the real task row. It has no synthetic
  // run envelope here: the following agent run owns the optimistic lifecycle.
  await insertSystemNotice(userId, sessionId, notice, ts, false)
  return runAgent(userId, sessionId, updated, allMessages, rest, ts, undefined, {
    commandOrigin: { command, label },
  })
}

/**
 * Handles `/model [@handle] [query]`: bare lists models available to the participant (scoped
 * to its provider connection if any); with a query, fuzzy-matches and switches THAT
 * participant — the one named, or the one the person's unaddressed words go to.
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
  if (!arg) {
    return directReply(formatModelList(available, participant.modelId))
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
        ? `No model matching "${arg}". Type \`/model\` to list available models.`
        : `Multiple models match "${arg}" — be more specific:\n\n${matches
            .slice(0, 10)
            .map((m) => `- \`${m.name}\``)
            .join('\n')}`
    return directReply(reply)
  }
  // `/model` re-routes ONE participant, never the whole conversation.
  const updated: SessionRecord = {
    ...withRoute(session, { modelId: matched.id }, participant.agentId),
    updatedAt: ts,
  }
  await persistRoute(ctx, userId, sessionId, updated, participant.agentId, {
    modelId: matched.id,
  })
  return insertSystemNotice(
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
    true,
  )
}

/**
 * Handles `/reasoning [@handle] <effort> [task]`: sets ONE participant's reasoning effort — the
 * one named, or the one the person's unaddressed words go to — and, if a task follows, runs it.
 */
export async function handleReasoningCommand(
  ctx: SettingCommandContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  allMessages: ExistingMessages,
  prompt: string,
  ts: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const target = await commandTarget(
    session,
    allMessages,
    prompt.trim().replace(/^\/\S+\s*/, ''),
    ctx.runner.leadership(userId, session.projectId),
  )
  if (!target) return directReply('Choose an agent before changing its reasoning effort.')
  const { participant } = target
  const { value, rest } = splitCommandArg(`/reasoning ${target.rest}`)
  if (!value || !(REASONING_EFFORTS as readonly string[]).includes(value)) {
    return directReply(
      `Usage: \`/reasoning [@handle] off|minimal|low|medium|high|max [task]\`. Current effort for @${participant.handle}: **${participant.reasoningEffort}**.`,
    )
  }
  const updated: SessionRecord = {
    ...withRoute(session, { reasoningEffort: value as ReasoningEffort }, participant.agentId),
    updatedAt: ts,
  }
  return persistSettingAndContinue(
    ctx,
    userId,
    sessionId,
    updated,
    participant.agentId,
    { reasoningEffort: value as ReasoningEffort },
    allMessages,
    rest,
    ts,
    {
      kind: 'reasoning_change',
      tone: 'neutral',
      participant: participant.handle,
      text: `${participant.handle} reasoning effort set to ${value}.`,
    },
    '/reasoning',
    value,
  )
}
