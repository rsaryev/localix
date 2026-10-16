export type AgentRunErrorCode =
  | 'AGENT_UNAVAILABLE'
  | 'NO_PROVIDER_CONNECTION'
  | 'NO_MODEL'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_ACCESS_DENIED'
  | 'PROVIDER_INSUFFICIENT_CREDITS'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'ABORTED'
  | 'HITL_DISMISSED'
  | 'HITL_TIMEOUT'

/**
 * Why a chosen model could not be bound to a working provider — the typed half of
 * `NO_PROVIDER_CONNECTION`.
 *
 * Three different failures used to share one code and one sentence ("No provider connection
 * selected"): a model the catalog no longer lists, a provider with no enabled key, and a
 * connection whose credential could not be loaded. Each has a different fix (pick another model,
 * connect or enable a key, sign in again), so the host names which one it was and the message
 * follows from that, never from matching prose.
 */
export type ModelUnavailableReason =
  | 'model_not_in_catalog'
  | 'no_enabled_key'
  | 'credential_unavailable'

export class AgentRunError extends Error {
  readonly code: AgentRunErrorCode
  /** Set with `NO_PROVIDER_CONNECTION` when the host knows which resolution step failed. */
  readonly reason?: ModelUnavailableReason

  constructor(
    code: AgentRunErrorCode,
    message: string,
    options?: { reason?: ModelUnavailableReason },
  ) {
    super(message)
    this.name = 'AgentRunError'
    this.code = code
    if (options?.reason) this.reason = options.reason
  }
}

export function isAgentRunError(err: unknown): err is AgentRunError {
  return err instanceof AgentRunError
}
