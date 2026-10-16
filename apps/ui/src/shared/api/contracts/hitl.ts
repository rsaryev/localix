import type {
  AskToolRequest,
  ConfigChangeRequest,
  ConfirmToolRequest,
  VaultItemType,
} from '@localixai/api/client'

// ---- Pending HITL interactions (UI shape) -----------------------------------
// The client-side shape of a pending ask/quiz/confirm request, derived from the
// API contract types. Defined here (shared) so both the backend client and the
// chat feature can use them; features/chat/model/agent-runtime re-exports them.

interface PendingHitlSource {
  /** Session whose run created this request; it may be rendered on an ancestor. */
  sourceSessionId?: string
}

export interface PendingAskInteraction extends PendingHitlSource {
  kind: 'ask'
  request: Omit<AskToolRequest, 'createdAt'> & { title?: string }
}

export interface PendingConfirmInteraction extends PendingHitlSource {
  kind: 'confirm'
  request: Omit<ConfirmToolRequest, 'createdAt'> & { title?: string }
}

/**
 * The value-free REQUEST leg of the `request_secret` HITL kind (raised by the `vault`
 * tool's create/rotate actions — there is no tool of that name): the overlay shows the
 * key + reason and collects the value in a masked input. The typed value itself
 * never joins this shape — it rides its own `submit-secret` frame straight to the
 * server's encrypted vault (see backendClient.submitSecret).
 */
export interface PendingRequestSecretInteraction extends PendingHitlSource {
  kind: 'request_secret'
  request: {
    id: string
    kind: 'request_secret'
    title?: string
    /** When silence becomes a refusal — the envelope field every other kind inherits. */
    expiresAt?: number
    payload: {
      action: 'create' | 'rotate'
      key: string
      reason: string
      type: VaultItemType
      label?: string
      description?: string
      tags: string[]
      expectedVersion?: number
    }
  }
}

/**
 * An agent-proposed configuration change awaiting the user's click (raised by the
 * `configure` tool). The payload IS the card: title, detail, diff and the scope choice.
 */
export interface PendingConfigChangeInteraction extends PendingHitlSource {
  kind: 'config_change'
  request: Omit<ConfigChangeRequest, 'createdAt'> & { title?: string }
}

export type UiPendingHitlInteraction =
  | PendingAskInteraction
  | PendingConfirmInteraction
  | PendingRequestSecretInteraction
  | PendingConfigChangeInteraction
