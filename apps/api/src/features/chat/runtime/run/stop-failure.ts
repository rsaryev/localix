/**
 * Claude Code's StopFailure: the turn ended on a provider error instead of an answer. Fired once
 * both retries declined the failure (`stages/fail.ts`), never for a stop the person made — CC
 * fires it in place of Stop, which a user interrupt does not reach either.
 */
import {
  extractProviderStatus,
  isAgentRunError,
  type AgentErrorInfo,
} from '@localixai/agent/agents'

import type { CcHooksRuntime } from '../../../cc-hooks'

/**
 * CC's error type (the matcher value) for a classified failure: `rate_limit`, `overloaded`,
 * `authentication_failed`, `billing_error`, `invalid_request`, `model_not_found`,
 * `server_error`, or `unknown`.
 */
export function stopFailureType(info: AgentErrorInfo, error: unknown): string {
  const code = isAgentRunError(error) ? error.code : undefined
  if (info.authFailed || code === 'PROVIDER_AUTH_FAILED') return 'authentication_failed'
  if (code === 'PROVIDER_INSUFFICIENT_CREDITS') return 'billing_error'
  // A spent plan or quota is billing; a transient 429 is a rate limit.
  if (info.rateLimited) return info.retryable ? 'rate_limit' : 'billing_error'
  if (code === 'PROVIDER_RATE_LIMITED') return 'rate_limit'
  if (info.modelUnavailable || code === 'PROVIDER_NOT_FOUND' || code === 'NO_MODEL')
    return 'model_not_found'
  if (info.kind === 'context_overflow') return 'invalid_request'
  const status = extractProviderStatus(error)
  if (status === 529) return 'overloaded'
  if (status === 400 || status === 413 || status === 422) return 'invalid_request'
  if (status === 404) return 'model_not_found'
  if (status >= 500 || info.kind === 'timeout' || code === 'PROVIDER_UNAVAILABLE')
    return 'server_error'
  return 'unknown'
}

/** Fire StopFailure for a final failure; observer-only, so never awaited by the run's ending. */
export function fireStopFailure(
  ccHooks: CcHooksRuntime | undefined,
  info: AgentErrorInfo,
  error: unknown,
  stopped: boolean,
): void {
  if (!ccHooks?.active || stopped || info.kind === 'abort' || info.kind === 'dismissed') return
  void ccHooks
    .runStopFailure({
      error: stopFailureType(info, error),
      ...(info.verbatim ? { details: info.userMessage } : {}),
      // CC's field holds the rendered error text here, not a reply.
      message: info.userMessage,
    })
    .catch(() => {})
}
