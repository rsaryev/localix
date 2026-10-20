/**
 * WHEN A FAILED REQUEST IS WORTH ANOTHER TRY, how long to wait, and what the host is told when
 * it is not.
 *
 * Only a request that produced nothing is retried: once a response has streamed content, a
 * retry would answer twice. A server that states its window (`Retry-After`, `retry-after-ms`)
 * is believed, up to a ceiling; otherwise the wait doubles from two seconds.
 */
import { APICallError } from '@ai-sdk/provider'
import { attachProviderResponse } from '@localixai/agent/agents'

export interface RetryPolicy {
  maxRetries: number
  maxDelayMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, maxDelayMs: 60_000 }

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

function statusOf(error: unknown): number | undefined {
  return APICallError.isInstance(error) ? error.statusCode : undefined
}

function headersOf(error: unknown): Record<string, string> | undefined {
  return APICallError.isInstance(error) ? error.responseHeaders : undefined
}

export function isRetryable(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    return error.isRetryable || (status !== undefined && RETRYABLE_STATUS.has(status))
  }
  // A connection that never completed: refused, reset, or cut off by the network.
  return (
    error instanceof TypeError ||
    (error instanceof Error && /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/iu.test(error.message))
  )
}

/** The server's own window, in milliseconds, when it stated one. */
function statedDelayMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const ms = Number(lower['retry-after-ms'])
  if (Number.isFinite(ms) && ms >= 0) return ms
  const after = lower['retry-after']
  if (!after) return undefined
  const seconds = Number(after)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(after)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

export function retryDelayMs(error: unknown, attempt: number, policy: RetryPolicy): number {
  const stated = statedDelayMs(headersOf(error))
  return Math.min(stated ?? 2_000 * 2 ** attempt, policy.maxDelayMs)
}

/** Wait, or stop waiting the moment the request is cancelled. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * The error the host classifies a failed response by, with the provider's status and headers
 * attached so a rate limit keeps its stated window.
 */
export function describeFailure(error: unknown): Error {
  const base = error instanceof Error ? error : new Error(String(error))
  const status = statusOf(error)
  if (status === undefined) return base
  const message =
    APICallError.isInstance(error) && error.responseBody
      ? `${base.message}: ${error.responseBody.slice(0, 2_000)}`
      : base.message
  const described =
    message === base.message
      ? base
      : Object.assign(new Error(message, { cause: base }), { name: base.name })
  return attachProviderResponse(described, { status, headers: headersOf(error) ?? {} })
}
