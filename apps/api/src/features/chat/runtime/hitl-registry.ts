import {
  createHumanInLoopController,
  HumanInLoopDismissedError,
  type HumanInLoopRequestBase,
} from '@localixai/agent/agents'

import { ApiError } from '../../../lib/errors'
import type { PendingHitlInteraction } from '../contracts'
import type { HitlLifecycleObserver } from '../../notifications/producers'
import { isInteractAllowedForOwner } from './interact-ownership'
import { AskDeferredError, type AskToolPayload } from '../../agent-core/tools/hitl/ask'

export interface PendingRequestMeta {
  /** Interactive session where the prompt is rendered and answered. */
  sessionId: string
  /** Session whose run is blocked on the answer. */
  sourceSessionId: string
  messageId: string
  toolCallId: string
  toolName: string
  /** Owning user — gates cross-tenant respond/dismiss (see interact-ownership). */
  userId?: string
}

export interface HitlRegistryOptions {
  /**
   * Vault-value redaction for an approval card's PAYLOAD, applied once when the request is tracked.
   *
   * The payload is built from the raw tool input — `permission-gate.ts` passes
   * `command: call.command` — and three consumers read it: the `hitl.requested` frame every
   * connected client receives, every enabled plugin's `onHitlRequest` hook (a third-party process),
   * and `listPendingInteractions`, which the session detail replays on reconnect. So a `bash` call
   * with an inline credential (`PGPASSWORD=… psql`) reached all three verbatim, while the transcript
   * item beside it was shielded.
   *
   * It belongs here because `trackRequest` is the one function both surfacing paths call — the
   * confirm flow (`hitl-confirm.ts`) and the generic `human_in_loop_request` handler — and because
   * `listPendingInteractions` reads back from this registry rather than from either caller.
   *
   * Presentation only. The SAFETY decision is made before this on the raw command (`isDangerous` in
   * `confirm-requester.ts`), and the tool executes from its own input, not from the card.
   */
  sanitizePayload?: (userId: string | undefined, payload: unknown) => unknown
  /**
   * A request that ended WITHOUT an answer or a dismissal — it expired, its run was aborted or
   * stopped, its sub-agent failed, its session was deleted.
   *
   * Only respond/dismiss used to announce `hitl.resolved`, so every other ending left the card's
   * Event Center row live ("Respond") for a question nobody was waiting on any more. Every one of
   * those endings passes through `clearRequest` (each surfacing caller clears in a `finally`, the
   * tool end clears by call id), and only there is the record still present — respond and dismiss
   * delete it first — so this is called exactly once per unanswered request and never for one the
   * facade already announced.
   */
  onClearedUnanswered?: (cleared: {
    requestId: string
    meta: PendingRequestMeta
    reason: 'expired' | 'cancelled'
  }) => void
  /**
   * The request's whole life, for the attention registry (and through it the journal): raised
   * when tracked, ended by each of the four ways it can end. Here because every surfacing path
   * tracks through this registry and every ending passes through it (`attention/sources.ts`).
   */
  lifecycle?: HitlLifecycleObserver
}

/**
 * Only a `confirm` payload may be redacted, and the reason is a correctness one, not a taste one.
 *
 * A redactor must never alter a value that comes BACK. For `confirm` the payload is purely
 * informational — `{command, cwd, description}` built by `permission-gate.ts` from the raw tool input,
 * which is exactly the credential path this shield exists to close — and the answer is a boolean plus
 * a grant keyed on the TOOL NAME, so nothing echoes the payload.
 *
 * `ask` and `quiz` are the opposite: their payload DEFINES the answer domain. The client submits the
 * option value string it was shown (`AskInteractionView`/`QuizInteractionView`),
 * and the tool filters the answer against `optionValue` of its OWN raw input
 * (`tools/hitl/ask.ts`, `quiz.ts`). Redacting an option therefore made the submitted value fail the
 * allowlist, `selectedOptions` collapse to `[]`, and the model be told "(no selection)" with no error
 * anywhere — and `quiz` then scored the answer wrong. A review caught that; it was a real regression
 * introduced by shielding this payload indiscriminately.
 *
 * `request_secret` is excluded for the same round-trip reason: its `{key, reason}` is what the submit
 * route matches on, and it is value-free by construction anyway.
 *
 * Residual, stated rather than hidden: an `ask` question or any request TITLE can still carry a vault
 * value verbatim. Both are composed by the MODEL, whose own context is shielded, so a vault value
 * reaching them would have to survive that first — a much narrower path than a tool input the gate
 * copies straight from `call.command`.
 */
const REDACTABLE_PAYLOAD_KINDS: ReadonlySet<string> = new Set(['confirm'])

export function createHitlRegistry(opts: HitlRegistryOptions = {}) {
  const controller = createHumanInLoopController()
  const metaByRequestId = new Map<string, PendingRequestMeta>()
  /** Shielded copies, keyed by request id — the only version any consumer may read. */
  const shownByRequestId = new Map<string, HumanInLoopRequestBase>()

  /**
   * EVERY outstanding request for the session, oldest-first (`listPending()` order).
   * A free function, not a method: callers destructure the registry, and `this` would
   * break the moment one did.
   */
  const listPendingInteractions = (sessionId: string): PendingHitlInteraction[] => {
    const interactions: PendingHitlInteraction[] = []
    for (const pending of controller.listPending()) {
      const meta = metaByRequestId.get(pending.request.id)
      if (meta?.sessionId !== sessionId) continue
      // The shielded copy, never `pending.request.payload`: this list is what the session detail
      // replays on reconnect, so reading the controller's raw request here would undo the redaction
      // for every client that reconnects while a card is open.
      const shown = shownByRequestId.get(pending.request.id) ?? pending.request
      interactions.push({
        requestId: pending.request.id,
        sourceSessionId: meta.sourceSessionId,
        kind: pending.request.kind,
        title: pending.request.title,
        payload: shown.payload,
        // Replayed on reconnect, so a card restored mid-wait resumes the same countdown
        // instead of appearing to have all its time back.
        ...(pending.request.expiresAt ? { expiresAt: pending.request.expiresAt } : {}),
      })
    }
    return interactions
  }

  return {
    controller,

    /**
     * Records the request and RETURNS the copy every consumer must show. Callers publish and hand to
     * plugin hooks from the return value, not from the request they passed in — that argument still
     * holds the raw payload, which only the awaiting tool and the safety check may see.
     */
    trackRequest(
      sessionId: string,
      messageId: string,
      toolCallId: string,
      toolName: string,
      request: HumanInLoopRequestBase,
      userId?: string,
      sourceSessionId: string = sessionId,
    ): HumanInLoopRequestBase {
      metaByRequestId.set(request.id, {
        sessionId,
        sourceSessionId,
        messageId,
        toolCallId,
        toolName,
        userId,
      })
      const shown =
        opts.sanitizePayload && REDACTABLE_PAYLOAD_KINDS.has(request.kind)
          ? { ...request, payload: opts.sanitizePayload(userId, request.payload) }
          : request
      shownByRequestId.set(request.id, shown)
      // The interaction rides along in the `hitl.requested` frame's shape — the SHIELDED copy —
      // so the attention snapshot can be answered from a session the client has not loaded.
      const interaction: PendingHitlInteraction = {
        requestId: request.id,
        sourceSessionId,
        kind: request.kind,
        title: request.title,
        payload: shown.payload,
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      }
      opts.lifecycle?.raised({
        userId,
        sessionId,
        requestId: request.id,
        title: shown.title,
        interaction: { messageId, toolCallId, toolName, request: interaction },
      })
      return shown
    },

    clearRequest(requestId: string) {
      const meta = metaByRequestId.get(requestId)
      const expiresAt = shownByRequestId.get(requestId)?.expiresAt
      metaByRequestId.delete(requestId)
      shownByRequestId.delete(requestId)
      // Still recorded means nobody answered or dismissed it (both delete the record first).
      if (meta) {
        const reason = expiresAt !== undefined && expiresAt <= Date.now() ? 'expired' : 'cancelled'
        opts.onClearedUnanswered?.({ requestId, meta, reason })
        opts.lifecycle?.ended({ userId: meta.userId, requestId, reason })
      }
    },

    listPendingInteractions,

    /** The head — oldest outstanding. DERIVED from the list so the two can't disagree. */
    getPendingInteraction(sessionId: string): PendingHitlInteraction | null {
      return listPendingInteractions(sessionId)[0] ?? null
    },

    getRequestMeta(requestId: string): PendingRequestMeta | null {
      return metaByRequestId.get(requestId) ?? null
    },

    respond(requestId: string, answers: unknown, callerUserId?: string) {
      const pending = controller.getPending(requestId)
      // Ownership gate: a different user must not answer another's HITL prompt.
      // Report as "not active" rather than leaking that the request exists.
      if (
        !pending ||
        !isInteractAllowedForOwner(metaByRequestId.get(requestId)?.userId, callerUserId)
      ) {
        throw new ApiError(409, 'hitl_request_not_active', 'HITL request is no longer active')
      }

      const accepted = controller.respond({
        requestId,
        kind: pending.request.kind,
        payload: { answers },
        respondedAt: Date.now(),
      })

      if (!accepted) {
        throw new ApiError(409, 'hitl_request_not_active', 'HITL request is no longer active')
      }

      const userId = metaByRequestId.get(requestId)?.userId
      // Both maps, always together: they are one record in two halves, and leaving the shielded
      // copy behind kept a redacted payload alive until an unrelated `clearRequest`.
      metaByRequestId.delete(requestId)
      shownByRequestId.delete(requestId)
      opts.lifecycle?.ended({ userId, requestId, reason: 'answered' })
    },

    dismiss(requestId: string, callerUserId?: string) {
      if (!isInteractAllowedForOwner(metaByRequestId.get(requestId)?.userId, callerUserId)) {
        throw new ApiError(409, 'hitl_request_not_active', 'HITL request is no longer active')
      }
      const accepted = controller.reject(requestId, new HumanInLoopDismissedError())
      if (!accepted) {
        throw new ApiError(409, 'hitl_request_not_active', 'HITL request is no longer active')
      }
      const userId = metaByRequestId.get(requestId)?.userId
      // Both maps, always together: they are one record in two halves, and leaving the shielded
      // copy behind kept a redacted payload alive until an unrelated `clearRequest`.
      metaByRequestId.delete(requestId)
      shownByRequestId.delete(requestId)
      opts.lifecycle?.ended({ userId, requestId, reason: 'dismissed' })
    },

    /** Release only a queueable ask; permissions and secret requests still need a decision. */
    defer(requestId: string, callerUserId?: string) {
      const pending = controller.getPending(requestId)
      const meta = metaByRequestId.get(requestId)
      if (
        !pending ||
        !isInteractAllowedForOwner(meta?.userId, callerUserId) ||
        pending.request.kind !== 'ask' ||
        (pending.request.payload as AskToolPayload).canDefer !== true
      ) {
        throw new ApiError(409, 'hitl_request_not_active', 'This question cannot be deferred')
      }
      if (!controller.reject(requestId, new AskDeferredError())) {
        throw new ApiError(409, 'hitl_request_not_active', 'HITL request is no longer active')
      }
      metaByRequestId.delete(requestId)
      shownByRequestId.delete(requestId)
      opts.lifecycle?.ended({ userId: meta?.userId, requestId, reason: 'deferred' })
    },
  }
}

export type HitlRegistry = ReturnType<typeof createHitlRegistry>
