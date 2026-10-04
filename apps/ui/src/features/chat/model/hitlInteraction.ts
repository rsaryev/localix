import { backendClient } from '@/shared/api/client'
import type {
  AgentStreamEvent,
  PendingAskInteraction,
  PendingConfigChangeInteraction,
  PendingConfirmInteraction,
  PendingRequestSecretInteraction,
  UiPendingHitlInteraction as PendingHitlInteraction,
} from '@/shared/api/contracts'

import { useChatStore } from './store'

type WireHitlRequest = Extract<AgentStreamEvent, { type: 'hitl.requested' }>['request']

/**
 * Maps the wire request a `hitl.requested` frame carries — and an attention item of kind
 * `interaction` repeats verbatim — to the UI pending-interaction shape.
 *
 * Takes `unknown` because the attention roster types its payload opaquely (it is the server's
 * cross-session copy, not a stream frame): a malformed or future-kind payload answers null and
 * the dialog simply offers "Open chat" instead of a form it cannot render.
 */
export function fromHitlRequest(value: unknown): PendingHitlInteraction | null {
  if (!value || typeof value !== 'object') return null
  const request = value as WireHitlRequest
  if (typeof request.requestId !== 'string') return null
  if (request.kind === 'ask') {
    return {
      kind: 'ask',
      request: {
        id: request.requestId,
        kind: 'ask',
        title: request.title,
        payload: request.payload as PendingAskInteraction['request']['payload'],
      },
    }
  }
  if (request.kind === 'confirm') {
    return {
      kind: 'confirm',
      request: {
        id: request.requestId,
        kind: 'confirm',
        title: request.title,
        payload: request.payload as PendingConfirmInteraction['request']['payload'],
      },
    }
  }
  if (request.kind === 'request_secret') {
    return {
      kind: 'request_secret',
      request: {
        id: request.requestId,
        kind: 'request_secret',
        title: request.title,
        payload: request.payload as PendingRequestSecretInteraction['request']['payload'],
      },
    }
  }
  if (request.kind === 'config_change') {
    return {
      kind: 'config_change',
      request: {
        id: request.requestId,
        kind: 'config_change',
        title: request.title,
        payload: request.payload as PendingConfigChangeInteraction['request']['payload'],
      },
    }
  }
  return null
}

/**
 * Shared recovery for a HITL respond/dismiss that the server rejected as
 * `hitl_request_not_active`: re-fetch the session that ASKED to resync its state and
 * stop the local generating spinner. Used by both answer and dismiss paths.
 *
 * The session is required: a missing one used to fall back to the chat on screen, so
 * a prompt answered from a background surface resynced — and stopped the spinner of —
 * a chat that had asked nothing. No session, nothing to recover.
 */
export function recoverInactiveHitlSession(id: string | null): void {
  if (!id) return
  void backendClient
    .getSession(id)
    .then((session) => {
      useChatStore.getState()._replaceSession(session)
      useChatStore.getState()._setSessionRunning(id, false)
    })
    .catch(() => {
      useChatStore.getState()._setSessionRunning(id, false)
    })
}
