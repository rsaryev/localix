/**
 * WHEN A FAILED REQUEST IS WORTH ANOTHER TRY, how long to wait, and what the host is told when
 * it is not.
 *
 * Only a request that produced nothing is retried: once a response has streamed content, a
 * retry would answer twice. A server that states its window (`Retry-After`, `retry-after-ms`)
 * is believed; a window longer than an in-request wait may last is not waited out here but
 * handed to the host, whose cooldown can honour it.
 */
import { APICallError } from '@ai-sdk/provider'
import { PROVIDER_HTTP_ERROR_NAME, providerHttpErrorMessage } from '@localixai/agent'
import { attachProviderResponse } from '@localixai/agent/agents'

export interface RetryPolicy {
  maxRetries: number
  maxDelayMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, maxDelayMs: 60_000 }

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

/**
 * A failure the provider reported inside the stream (Anthropic's `overloaded_error`, OpenAI's
 * `response.failed`, …). The SDKs hand these over as plain objects, not `Error`s.
 */
interface StreamErrorShape {
  message: string
  type?: unknown
  code?: unknown
  statusCode?: unknown
  isRetryable?: unknown
}

function streamErrorOf(error: unknown): StreamErrorShape | undefined {
  if (typeof error !== 'object' || error === null || error instanceof Error) return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? (error as StreamErrorShape) : undefined
}

function statusOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode
  const status = streamErrorOf(error)?.statusCode
  return typeof status === 'number' && status >= 100 && status < 600 ? status : undefined
}

function headersOf(error: unknown): Record<string, string> | undefined {
  return APICallError.isInstance(error) ? error.responseHeaders : undefined
}

/** Ends of a response that carried nothing and say nothing about the request: worth resending. */
const RESENDABLE_ENDINGS = new Set(['StreamIdleTimeoutError', 'ProviderPrematureCloseError'])

/** A connection that never completed: refused, reset, cut off by the network. */
function isNetworkFailure(error: Error): boolean {
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|fetch failed/iu.test(error.message))
    return true
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && /^(ECONN|ETIMEDOUT|EPIPE|UND_ERR_)/u.test(code)) return true
  return error.cause instanceof Error && isNetworkFailure(error.cause)
}

export function isRetryable(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    return error.isRetryable || (status !== undefined && RETRYABLE_STATUS.has(status))
  }
  const streamError = streamErrorOf(error)
  if (streamError) {
    const status = statusOf(error)
    return (
      streamError.isRetryable === true || (status !== undefined && RETRYABLE_STATUS.has(status))
    )
  }
  if (!(error instanceof Error)) return false
  if (RESENDABLE_ENDINGS.has(error.name)) return true
  return isNetworkFailure(error)
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

/**
 * How long to wait before the next attempt, or undefined when this request should not be resent
 * here: the server asked for longer than an in-request wait may last, and waiting less would
 * only earn a second refusal.
 */
export function retryDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
): number | undefined {
  const stated = statedDelayMs(headersOf(error))
  if (stated !== undefined) return stated > policy.maxDelayMs ? undefined : stated
  return Math.min(2_000 * 2 ** attempt, policy.maxDelayMs)
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
 * The error the host classifies a failed response by. A provider's HTTP refusal takes the
 * provider-HTTP shape the host's classifier reads (its name, and `<provider> <status>: <body>`),
 * with the status and headers attached so a rate limit keeps its stated window; a failure the
 * provider streamed keeps its own words instead of becoming `[object Object]`.
 */
export function describeFailure(error: unknown, provider = 'provider'): Error {
  const streamError = streamErrorOf(error)
  const base =
    error instanceof Error
      ? error
      : streamError
        ? Object.assign(new Error(streamError.message || 'The provider reported an error'), {
            ...(typeof streamError.type === 'string' ? { type: streamError.type } : {}),
            ...(streamError.code !== undefined ? { code: streamError.code } : {}),
          })
        : new Error(typeof error === 'string' ? error : 'The provider reported an error')
  const status = statusOf(error)
  if (status === undefined) {
    if (!streamError) return base
    // A streamed failure with no status: its type is the most specific word it has.
    const type = typeof streamError.type === 'string' ? streamError.type : undefined
    return type && !base.message.includes(type)
      ? Object.assign(new Error(`${type}: ${base.message}`, { cause: base }), { name: base.name })
      : base
  }
  // The SDK's message is usually lifted out of the body; the body is added only when it says more.
  const responseBody = APICallError.isInstance(error) ? error.responseBody : undefined
  const body =
    responseBody && !responseBody.includes(base.message)
      ? `${base.message}: ${responseBody.slice(0, 2_000)}`
      : base.message
  const described = Object.assign(
    new Error(providerHttpErrorMessage(provider, status, body), { cause: base }),
    { name: PROVIDER_HTTP_ERROR_NAME },
  )
  return attachProviderResponse(described, { status, headers: headersOf(error) ?? {} })
}
