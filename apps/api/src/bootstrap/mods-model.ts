import {
  NO_USAGE,
  type ModelCompletion,
  type ModelUsage,
  type ModsPorts,
} from '../features/mods/contracts'
import type { createAuxProviderHelpers } from '../features/chat/service/aux-provider'

/**
 * A mod's completion as Claude Code reports it (`$.model.complete`): a provider's failure is an
 * `api-error` with the response's status and the failure's kind — never its text — and a call cut
 * by its signal is `aborted`; neither rejects. Bound to the model route by `createModCompletion`.
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

/**
 * `$.model.complete` bound to Localix's model routes: the conversation's own model unless the mod
 * names one, built through the auxiliary provider helpers, one user turn holding the question.
 */
export function createModCompletion(deps: {
  aux: Pick<ReturnType<typeof createAuxProviderHelpers>, 'buildLanguageModel'>
  chat: () =>
    | {
        getSessionAgentRoute(
          userId: string,
          sessionId: string,
        ): Promise<{ providerConnectionId: string | null; modelId: string | null } | null>
      }
    | undefined
  defaultUserId: string
}): ModsPorts['complete'] {
  const { aux, chat, defaultUserId } = deps
  return async (scene, request): Promise<ModelCompletion> => {
    const userId = scene.userId || defaultUserId
    const route = scene.sessionId
      ? await chat()
          ?.getSessionAgentRoute(userId, scene.sessionId)
          .catch(() => null)
      : null
    const modelId = request.model ?? route?.modelId
    const refused = (status: number | null, error: string): ModelCompletion => ({
      isAnswered: false,
      reason: 'api-error',
      status,
      error,
      usage: usageOf(null),
    })
    if (!modelId) return refused(null, 'invalid_request')
    const built = await aux
      .buildLanguageModel(userId, modelId, route?.providerConnectionId)
      .catch(() => null)
    if (!built) return refused(null, 'invalid_request')
    // `$.model.fork`: the conversation so far, as the transcript the one question follows.
    const transcript = (request.history ?? [])
      .map(({ role, text }) => `${role === 'user' ? 'User' : 'Assistant'}: ${text}`)
      .join('\n\n')
    try {
      const message = await built.model.complete({
        systemPrompt: request.system ?? '',
        messages: [
          {
            role: 'user',
            content: transcript
              ? `The conversation so far:\n\n${transcript}\n\n${request.prompt}`
              : request.prompt,
            timestamp: Date.now(),
          },
        ],
        maxOutputTokens: Math.min(request.maxTokens ?? 1024, 64_000),
        reasoningEffort: request.effort ?? 'off',
        ...(scene.sessionId ? { sessionId: scene.sessionId } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      })
      return { isAnswered: true, text: textOf(message.content), usage: usageOf(message.usage) }
    } catch (error) {
      // What the provider did never rejects a mod's call (Claude Code's `api-error`).
      return failedCompletion(error, request.signal)
    }
  }
}

/** The text of a model reply: its text parts, joined. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        ? [
            typeof (part as { text?: unknown }).text === 'string'
              ? (part as { text: string }).text
              : '',
          ]
        : [],
    )
    .join('')
}
