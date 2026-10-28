/**
 * Human-in-the-loop event handlers for one run. They operate on
 * RunTurnState through the shared TurnEventContext and bridge agentLoop HITL
 * events to the HITL registry, the stream, and observer-only plugin hooks.
 * Extracted from event-handlers.ts to keep the per-event dispatcher focused.
 */
import type { HumanInLoopRequestBase } from '@localixai/agent/agents'
import { runHitlRequestHooks, runHitlResolvedHooks } from '../../../mini-apps/hooks'
import type { EventOf, TurnEventContext } from './event-handlers'
import { hostPolicy } from '../../policy/session-policy'

export function handleHitlRequest(ctx: TurnEventContext, event: EventOf<'human_in_loop_request'>) {
  const { env, state, session } = ctx
  // Keep routing kind-agnostic: the built-in `ask`/`quiz` tools, the `request_secret`
  // kind the `Vault` tool raises, and provider or plugin HITL kinds all carry the same
  // base envelope.
  const request = event.request as HumanInLoopRequestBase
  const targetSessionId = ctx.hitlTargetSessionId
  if (!targetSessionId) {
    throw new Error(`Cannot surface HITL request from session ${session.id}: invalid ancestry`)
  }
  // One reading, two consumers: the run's own HITL wait accounting and the frame's `requestedAt`.
  // A second `Date.now()` for the frame could drift from the time this run believes it asked.
  const requestedAt = Date.now()
  state.hitlStartTimes.set(event.toolCallId, requestedAt)
  // A question is a person's sentence, not a tool name ("ask needs input" read like a permission).
  const requestTitle =
    request.title?.trim() ||
    (request.kind === 'ask' ? 'The agent asks' : `${event.toolName} needs input`)
  const asSubagent = hostPolicy(session).presentsAsSubagent
  const toolName = asSubagent ? `sub-agent · ${event.toolName}` : event.toolName
  const surfacedRequest = asSubagent
    ? {
        ...request,
        title: `Sub-agent "${session.title}" needs input: ${requestTitle}`,
      }
    : { ...request, title: requestTitle }
  // `shown` carries the shielded payload; `surfacedRequest` still holds the raw one, which only the
  // awaiting tool may see. Everything that leaves this process reads `shown`.
  const shown = env.deps.hitlRegistry.trackRequest(
    targetSessionId,
    ctx.assistantMessageId,
    event.toolCallId,
    toolName,
    surfacedRequest,
    ctx.userId,
    session.id,
  )
  env.deps.streamRegistry.publish(ctx.userId, targetSessionId, {
    type: 'hitl.requested',
    sessionId: targetSessionId,
    messageId: ctx.assistantMessageId,
    toolCallId: event.toolCallId,
    toolName,
    requestedAt,
    request: {
      requestId: shown.id,
      sourceSessionId: session.id,
      kind: shown.kind,
      title: shown.title,
      payload: shown.payload,
      // When silence becomes a refusal. Forwarded from the request the controller is timing,
      // so the card's countdown and the server's deadline are the same instant.
      ...(shown.expiresAt ? { expiresAt: shown.expiresAt } : {}),
    },
  })
  if (ctx.miniAppHooksForRun.length > 0) {
    void runHitlRequestHooks(
      ctx.miniAppHooksForRun,
      {
        sessionId: session.id,
        requestId: shown.id,
        kind: shown.kind as 'ask' | 'quiz' | 'config_change',
        toolName: event.toolName,
        // `shown`, not `request`: every field handed to third-party code comes from the one copy the
        // registry blessed, so a future field added to the shield cannot be missed here.
        title: shown.title,
        payload: shown.payload,
      },
      ctx.hookRunOptions,
    )
  }
  // CC Notification hook — the agent needs the user to answer (CC's
  // `agent_needs_input` notification type). Observer-only, fire-and-forget.
  void ctx.ccHooks
    .runNotification({
      message: `Agent needs input: ${surfacedRequest.title}`,
      notificationType: 'agent_needs_input',
      title: surfacedRequest.title,
    })
    .catch(() => {})
}

export function handleHitlResponse(
  ctx: TurnEventContext,
  event: EventOf<'human_in_loop_response'>,
) {
  // Observer-only plugin hook: a pending ask/quiz was answered. A dismissed
  // ask/quiz rejects its tool call without this event (confirm-path dismissals
  // are covered in createConfirmRequester below).
  if (ctx.miniAppHooksForRun.length > 0) {
    void runHitlResolvedHooks(
      ctx.miniAppHooksForRun,
      {
        sessionId: ctx.session.id,
        requestId: event.response.requestId,
        kind: event.response.kind as 'ask' | 'quiz' | 'config_change',
        toolName: event.toolName,
        response: event.response.payload,
      },
      ctx.hookRunOptions,
    )
  }
}
