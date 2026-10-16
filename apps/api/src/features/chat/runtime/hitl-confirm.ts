import type { ConfirmToolPayload, ConfirmToolRequest } from '../../agent-core/tools/hitl/confirm'
import { hitlDecisionDeadline } from '../../agent-core/tools/hitl/decision-deadline'
import type { HitlRegistry } from './hitl-registry'
import type { SessionStreamRegistry } from './session-stream-registry'

/**
 * The id EVERY confirm card is keyed by: `perm:<toolCallId>`. The tracked request,
 * the `hitl.requested` event's `requestId` and the eventual `clearRequest` all use
 * this spelling — the UI resolves a card (respond / dismiss) through it, so the
 * three must agree. One spelling, one place.
 */
export const confirmRequestId = (toolCallId: string): string => `perm:${toolCallId}`

/**
 * Surface a confirm card: build the request, TRACK it in the HITL registry and
 * PUBLISH the matching `hitl.requested` event — as one step.
 *
 * The track and the publish are a PAIR: the registry entry is what `interact`
 * (respond/dismiss) resolves against, the event is what renders the card, and they
 * must describe the same request (same id, kind, title, payload). That pairing plus
 * the id spelling used to be hand-copied in the two confirm paths — the per-run
 * tool-approval requester ({@link ./run/confirm-requester}) and the standalone
 * the isolation confirm on the runner — so the event shape lived in two places and a
 * change to it was shotgun surgery. It lives here now.
 *
 * Resolution policy is deliberately NOT here. The run path layers plugin
 * `onHitlRequest`/`onHitlResolved` hooks, the CC Notification hook and "Always
 * allow" session grants on top; the standalone path just awaits a yes/no. Folding
 * both into one function would only buy a bag of mode flags. Callers therefore
 * `await hitlRegistry.controller.request(request)` themselves and MUST
 * `hitlRegistry.clearRequest(request.id)` in a `finally`.
 */
export function surfaceConfirmRequest(args: {
  hitlRegistry: HitlRegistry
  streamRegistry: SessionStreamRegistry
  userId: string
  /**
   * Session the card renders in. NOT necessarily the session that asked: a
   * descendant routes its confirm to the root chat (see `chat/session-ancestry.ts`).
   */
  sessionId: string
  /** Session whose run requested the confirmation. Defaults to the rendering session. */
  sourceSessionId?: string
  /** Assistant message the card hangs off; `""` for a confirm outside any run. */
  messageId: string
  toolCallId: string
  /** Tool name as SHOWN (the sub-agent path decorates it) — card label + hooks. */
  toolName: string
  title: string
  payload: ConfirmToolPayload
}): ConfirmToolRequest {
  const request: ConfirmToolRequest = {
    id: confirmRequestId(args.toolCallId),
    kind: 'confirm',
    title: args.title,
    payload: args.payload,
    createdAt: Date.now(),
    // Both confirm paths used to wait forever, so a run that asked while nobody was at the
    // keyboard stayed blocked until the process restarted. The controller enforces this and
    // rejects with `HumanInLoopTimeoutError`, which each caller reports as an AUTO-denial —
    // never as a person saying no. See `hitl/decision-deadline.ts`.
    expiresAt: hitlDecisionDeadline(),
  }
  // The tracked copy is the SHOWN one: its payload has been through the vault shield, so an inline
  // credential in the command does not reach the wire (or, via the caller, a plugin hook).
  const shown = args.hitlRegistry.trackRequest(
    args.sessionId,
    args.messageId,
    args.toolCallId,
    args.toolName,
    request,
    args.userId,
    args.sourceSessionId ?? args.sessionId,
  )
  args.streamRegistry.publish(args.userId, args.sessionId, {
    type: 'hitl.requested',
    sessionId: args.sessionId,
    messageId: args.messageId,
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    // The REQUEST's own creation time, not a second clock reading: the two must not be able to
    // drift, and "when the agent asked" is a property of the request.
    requestedAt: request.createdAt,
    request: {
      requestId: request.id,
      sourceSessionId: args.sourceSessionId ?? args.sessionId,
      kind: 'confirm',
      title: args.title,
      payload: shown.payload as ConfirmToolPayload,
      // The card counts down to the same instant the controller will act on, rather than to a
      // deadline the client derived for itself and could drift from.
      expiresAt: request.expiresAt,
    },
  })
  return shown as ConfirmToolRequest
}
