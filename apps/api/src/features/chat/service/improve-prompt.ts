import { sessionRoute } from '../session-route'
import { getTextContent, userMessage, type Usage } from '@localixai/agent'

import { ApiError } from '../../../lib/errors'
import { resolveLanguageModel } from '../runtime/model-resolution'
import type { SessionRecord } from '../repository'
import type { ChatServiceDeps } from './context'

const IMPROVE_SYSTEM_PROMPT =
  'Rewrite the user prompt to be clearer, more specific, and ready for an AI assistant. Return only the improved prompt, no explanations.'

/** Closure values the improve-prompt op needs from createChatService. */
export interface ImprovePromptContext {
  deps: Pick<
    ChatServiceDeps,
    'providerConnectionsService' | 'catalogService' | 'languageModelFactory'
  >
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  /** Fold this wand's spend into the usage ledger (fire-and-forget). Mirrors the
   *  other composer aux calls (autocomplete/suggest/commit). */
  recordUsage?: (e: {
    userId: string
    sessionId: string
    modelId: string
    providerConnectionId?: string | null
    providerId?: string | null
    usage: Usage | undefined
  }) => void
}

/**
 * One-shot rewrite of the composer text through the session's own provider +
 * model (the "improve prompt" wand). Returns the rewritten text only.
 */
export async function improvePrompt(
  ctx: ImprovePromptContext,
  userId: string,
  sessionId: string,
  prompt: string,
): Promise<{ prompt: string }> {
  const session = await ctx.requireSession(userId, sessionId)
  if (!sessionRoute(session).providerConnectionId) {
    throw new ApiError(409, 'provider_connection_required', 'Choose a provider connection first')
  }
  if (!sessionRoute(session).modelId) {
    throw new ApiError(409, 'model_required', 'Choose a model first')
  }

  const resolved = await resolveLanguageModel({
    deps: ctx.deps,
    userId,
    modelId: sessionRoute(session).modelId,
    preferredConnectionId: sessionRoute(session).providerConnectionId,
  })
  if (!resolved) throw new ApiError(400, 'model_unavailable', 'Selected model is unavailable')
  const completion = await resolved.model.complete({
    systemPrompt: IMPROVE_SYSTEM_PROMPT,
    messages: [userMessage(prompt)],
    reasoningEffort: sessionRoute(session).reasoningEffort,
  })

  ctx.recordUsage?.({
    userId,
    sessionId,
    modelId: sessionRoute(session).modelId,
    providerConnectionId: resolved.providerConnectionId,
    providerId: resolved.entry.id,
    usage: completion.usage,
  })

  return { prompt: getTextContent(completion) }
}
