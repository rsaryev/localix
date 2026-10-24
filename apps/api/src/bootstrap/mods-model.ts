import { NO_USAGE, type ModelCompletion, type ModelUsage } from '../features/mods/contracts'

/**
 * A mod's completion as Claude Code reports it (`$.model.complete`): a provider's failure is an
 * `api-error` with the response's status and the failure's kind — never its text — and a call cut
 * by its signal is `aborted`; neither rejects. Bound to the model route in `mods.ts`.
 */

/** The failure's kind, by Claude Code's names for API errors. */
function kindOf(status: number | null, error: unknown): string {
  if (status === 429) return 'rate_limit'
  if (status === 529 || status === 503) return 'overloaded'
  if (status === 401 || status === 403) return 'authentication_failed'
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'invalid_request'
  if (status !== null && status >= 500) return 'server_error'
  const name = error instanceof Error ? error.name : ''
  return /timeout/i.test(name) ? 'timeout' : 'unknown'
}

/** The HTTP status a provider's error carries, if any. */
function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const record = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  const status = record.status ?? record.statusCode ?? record.response?.status
  return typeof status === 'number' && Number.isInteger(status) ? status : null
}

export function failedCompletion(error: unknown, signal?: AbortSignal): ModelCompletion {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
    return { isAnswered: false, reason: 'aborted', usage: NO_USAGE }
  const status = statusOf(error)
  return {
    isAnswered: false,
    reason: 'api-error',
    status,
    error: kindOf(status, error),
    usage: NO_USAGE,
  }
}

/** A reply's usage in the API's spelling; a count it left out reads as zero. */
export function usageOf(
  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
      }
    | null
    | undefined,
): ModelUsage {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_input_tokens: usage?.cacheReadTokens ?? 0,
    cache_creation_input_tokens: usage?.cacheWriteTokens ?? 0,
  }
}
