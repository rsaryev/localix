import { ConflictError, NotFoundError } from '../../../lib/domain-errors'
import type { SeatRouteFor } from './session-route-defaults'
import { assetBindings, type MessageAttachment } from '@localixai/agent'
import type { ResolveSessionAgent } from './session-agent-selection'
import { bornParticipants } from './participant-routes'
import type { ChannelRunEvent } from '../../plugins/native'
import type { createChatRepository, SessionRecord } from '../repository'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { RunAgentFn } from './run-agent'
import type { SessionMutationLock } from './session-access'
import { childExecutionContext } from '../runtime/execution-context'
import { sessionRoute } from '../session-route'
import { mirrorRunToChannel } from './channel-run-mirror'

export interface ExternalSessionInput {
  key: string
  title: string
  projectId?: string
  noProviderMessage?: string
}

/** Token/cost totals for ONE turn (the final assistant message's usage). */
export interface TurnUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  totalCost?: number
}

export interface ExternalTurnResult {
  sessionId: string
  messageId: string
  reply: string
  bindings?: MessageAttachment[]
  /** This turn's usage (tokens + cost), from the final assistant message. */
  usage?: TurnUsage
}

export interface ChannelInboundInput {
  pluginName: string
  channelName: string
  message: {
    conversationId: string
    text: string
    title?: string
    sessionId?: string
    projectId?: string
    bindings?: MessageAttachment[]
    onEvent?: (event: ChannelRunEvent) => void
  }
}

export interface ChannelInboundResult {
  sessionId: string
  reply: string
  bindings?: MessageAttachment[]
  usage?: TurnUsage
}

/** Closure values the external-session operations need from createChatService. */
export interface ExternalSessionsContext {
  repo: ReturnType<typeof createChatRepository>
  streamRegistry: SessionStreamRegistry
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  runAgent: RunAgentFn
  withSessionMutationLock: SessionMutationLock
  /**
   * The project an external session lands in when the caller named none.
   *
   * An inbound webhook or a channel message has no project to speak of, and a session's
   * `projectId` is not nullable — "no project" used to mean the global capability scope, which
   * is the last place an UNATTENDED turn should be filed under.
   */
  resolveDefaultProjectId: (userId: string) => Promise<string>
  /** How a participant is resolved and what effort it is born with — the birth path's ports. */
  resolveSessionAgent?: ResolveSessionAgent
  seatRoute?: SeatRouteFor
}

/**
 * Find-or-create the persistent chat session behind an EXTERNAL inbound surface
 * (plugin channels, the OpenAI-compatible API server). Sessions are keyed by
 * `sourceToolCallId` so follow-ups continue the same conversation, and each one
 * is a normal chat the user can open in the workspace.
 *
 * It states no model. An unattended conversation is an ordinary chat, so it takes the ordinary
 * answer — your last choice for this agent, the project's default, its card — resolved on every
 * read (`agent-route-resolution.ts`). It used to copy "the last session that had a connection AND
 * a model", freezing an inbound conversation onto whatever was current the day it started.
 */
export async function resolveExternalSession(
  ctx: ExternalSessionsContext,
  userId: string,
  input: ExternalSessionInput,
): Promise<{ session: SessionRecord; created: boolean }> {
  const existing = await ctx.repo.getExternalSession(userId, input.key)
  if (existing) return { session: existing, created: false }
  const timestamp = ctx.now()
  const projectId = input.projectId ?? (await ctx.resolveDefaultProjectId(userId))
  const agents = await bornParticipants({
    userId,
    projectId,
    host: 'chat',
    resolve: ctx.resolveSessionAgent,
    seat: ctx.seatRoute,
  })
  const created = await ctx.repo.getOrCreateExternalSession(userId, input.key, ({ seq, id }) => ({
    id,
    seq,
    userId,
    title: input.title,
    isPinned: false,
    projectId,
    parentSessionId: null,
    rootSessionId: null,
    sessionKind: 'chat',
    // An externally-driven turn is an ordinary chat: the human on one side, the default agent
    // on the other, seated the way every birth seats it. The channel that drove it is
    // provenance, not a participant.
    agents,
    description: null,
    avatar: null,
    runtimeStatus: 'idle',
    sourceToolCallId: input.key,
    provenance: { kind: 'root' },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    executionBackend: 'local',
    executionTarget: null,
    pinnedSkills: [],
    activatedTools: [],
    archivedAt: null,
  }))
  // Refuse HERE rather than at the first turn: an API client that has never opened the workspace
  // gets one actionable 409 instead of a run that dies on NO_MODEL. On the RESOLVED record, so a
  // model configured on the project or on the agent's card counts — which the old "some previous
  // chat had a connection" test could not see. The row left behind is keyed by the external key,
  // so a retry reuses it rather than piling up empty conversations.
  const resolved = (await ctx.repo.getExternalSession(userId, input.key)) ?? created.session
  if (!sessionRoute(resolved).modelId) {
    throw new ConflictError(
      'no_provider_connection',
      input.noProviderMessage ??
        'No provider connection available. Open the workspace and connect a provider first.',
    )
  }
  return { ...created, session: resolved }
}

/**
 * Run one full agent turn on an externally-driven session and resolve with the
 * final assistant text. Used by plugin channels and the API server; stream
 * consumers subscribe to `streamRegistry` BEFORE calling this.
 */
export async function runExternalTurn(
  ctx: ExternalSessionsContext,
  userId: string,
  sessionId: string,
  text: string,
  inboundBindings?: MessageAttachment[],
): Promise<ExternalTurnResult> {
  return ctx.withSessionMutationLock(sessionId, async () => {
    const fresh = await ctx.requireSession(userId, sessionId)
    // Channel code may be plain JavaScript, so the SDK type is not a trust
    // boundary. External surfaces may attach user-uploaded assets only; they
    // cannot mint host-resolved context or executable invocation authority.
    const inboundAssets = assetBindings(inboundBindings)
    const { messageId } = await ctx.runAgent(
      userId,
      sessionId,
      fresh,
      () => ctx.repo.listMessages(userId, sessionId),
      text,
      ctx.now(),
      inboundAssets.length > 0 ? inboundAssets : undefined,
      { wait: true, executionContext: childExecutionContext({ kind: 'channel' }) },
    )
    // The final assistant row exists only after the waited run completes. Fetch
    // that immutable id directly; reloading the now-larger transcript would
    // duplicate every payload parse on each channel/API turn.
    const final = await ctx.repo.getMessage(userId, sessionId, messageId)
    const reply = (final?.payload.content ?? '').trim()
    // Hook-produced attachments ride
    // along so channels can upload them platform-natively.
    const bindings = assetBindings(final?.payload.bindings)
    const usage = final?.payload.usage
    return {
      sessionId,
      messageId,
      reply,
      ...(bindings.length ? { bindings } : {}),
      ...(usage ? { usage } : {}),
    }
  })
}

/**
 * Entry point for plugin CHANNELS (external chat platforms — see
 * plugins/channel-host.ts): routes an external platform message into a
 * persistent chat session and resolves with the agent's final reply text.
 *
 * Each (plugin, channel, conversation) maps to ONE session, keyed via
 * sourceToolCallId — follow-ups continue the same conversation, and the session
 * is a normal chat the user can open and continue in the workspace.
 *
 * Which session, in one rule: a message that NAMES a session runs there or is rejected;
 * only a message that names none runs in the conversation-keyed session. A named session
 * that is deleted or not a chat used to fall through to the conversation-keyed one,
 * silently — the person had switched to chat B in the platform, and their message ran in
 * chat A with nothing saying so. The rejection reaches the channel as an error it can show
 * ("that session is gone — pick another"), which is the self-healing the fallback was
 * after, done by the person rather than guessed. The conversation key is not a guess: it
 * is the stored binding of this platform conversation, created on its first message.
 */
export async function handleChannelInbound(
  ctx: ExternalSessionsContext,
  userId: string,
  input: ChannelInboundInput,
): Promise<ChannelInboundResult> {
  // Channel code may be plain JavaScript: `null` and `''` are how it spells "no session".
  const named: string | null | undefined = input.message.sessionId
  let targetSessionId: string
  if (named) {
    const pinned = named.trim() ? await ctx.repo.getSession(userId, named) : null
    if (!pinned) {
      throw new NotFoundError(
        'channel_session_not_found',
        `The session this message names (${named}) does not exist; choose another session.`,
      )
    }
    if (pinned.sessionKind !== 'chat') {
      throw new ConflictError(
        'channel_session_not_chat',
        `The session this message names (${named}) is not a chat and cannot take a message.`,
      )
    }
    targetSessionId = pinned.id
  } else {
    const key = `channel:${input.pluginName}:${input.channelName}:${input.message.conversationId}`
    const { session } = await resolveExternalSession(ctx, userId, {
      key,
      title: input.message.title?.trim() || `${input.pluginName}: ${input.message.conversationId}`,
      projectId: input.message.projectId,
      noProviderMessage: `No provider connection available for channel "${input.pluginName}:${input.channelName}". Open the workspace and connect a provider first.`,
    })
    targetSessionId = session.id
  }

  // Subscribed BEFORE the turn starts (see `mirrorRunToChannel`).
  const onEvent = input.message.onEvent
  const unsubscribe = onEvent
    ? mirrorRunToChannel(ctx.streamRegistry, targetSessionId, onEvent)
    : undefined

  try {
    const { sessionId, reply, bindings, usage } = await runExternalTurn(
      ctx,
      userId,
      targetSessionId,
      input.message.text,
      input.message.bindings,
    )
    return {
      sessionId,
      reply,
      ...(bindings?.length ? { bindings } : {}),
      ...(usage ? { usage } : {}),
    }
  } finally {
    unsubscribe?.()
  }
}
