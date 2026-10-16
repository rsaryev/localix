import { attachProviderResponse, providerResponseOf } from '@localixai/agent/agents'

/**
 * Re-attach the provider response to the error the host will classify. Without this the
 * whole run reduces to a message string: `Retry-After` is gone, and every rate-limit
 * cooldown falls back to an invented constant however precisely the server stated its
 * window. An error that already carries its own response (an SDK error that reached us
 * unflattened) is left alone — that one is closer to the failure than our last-seen refusal.
 */
export function failedWithProviderFacts(
  error: Error,
  refusal: { status: number; headers: Record<string, string> } | undefined,
): Error {
  if (!refusal || providerResponseOf(error)) return error
  return attachProviderResponse(error, refusal)
}
