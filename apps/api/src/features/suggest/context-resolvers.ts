/**
 * What grounds each text-input surface ITSELF — the chat transcript for the composer, the change
 * set for a commit subject. Everything the user is working with besides that (open tabs, linked
 * chips) is not a surface's business: the service resolves it once, through Context Fabric, for
 * every surface in the call (`surface-context.ts`).
 *
 * The answer is contributions, not text, so the service can put a surface's own context through
 * the same admission policy as a provider's before a byte of it reaches the prompt.
 */
import { isTextItem } from '@localixai/agent/agents'

import type { ContextContribution } from '@localixai/mini-app-sdk/backend'
import {
  isContributedSurfaceId,
  type InlineCompletionContextRequest,
  type InlineCompletionSurfacePayloads,
} from '../inline-completion/contracts'
import type { createChatService } from '../chat/service'
import { renderSessionDigest } from './digest'

export type SurfaceContextResolver = (
  userId: string,
  sessionId: string,
  request: InlineCompletionContextRequest,
  signal?: AbortSignal,
  deadlineAtMs?: number,
) => Promise<readonly ContextContribution[]>

export type InlineCompletionContextResolverMap = {
  [K in keyof InlineCompletionSurfacePayloads]: (
    userId: string,
    sessionId: string,
    payload: InlineCompletionSurfacePayloads[K],
    signal?: AbortSignal,
    deadlineAtMs?: number,
  ) => Promise<readonly ContextContribution[]>
}

export interface InlineCompletionContextResolverDeps {
  chatService: Pick<ReturnType<typeof createChatService>, 'getInlineCompletionContext'>
  /**
   * A contributed surface resolves its OWN context — the mini app that owns the field is the only
   * thing that knows what grounds a completion in it. Absent → the surface declines, which is the
   * same outcome as an unregistered id.
   */
  contributedContext?: (
    id: string,
    request: {
      userId: string
      sessionId: string
      payload: unknown
      signal?: AbortSignal
      deadlineAtMs?: number
    },
  ) => Promise<readonly ContextContribution[]> | undefined
}

const expired = (signal?: AbortSignal, deadlineAtMs?: number) =>
  Boolean(signal?.aborted) || (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs)

/** Correlated dispatch is intentionally isolated at the registry boundary. */
export function dispatchInlineCompletionContext(
  resolvers: InlineCompletionContextResolverMap,
  userId: string,
  sessionId: string,
  request: InlineCompletionContextRequest,
  signal?: AbortSignal,
  deadlineAtMs?: number,
  contributed?: InlineCompletionContextResolverDeps['contributedContext'],
): Promise<readonly ContextContribution[]> {
  if (isContributedSurfaceId(request.surface)) {
    // A surface nobody owns resolves to no context, which makes it un-actionable and drops it from
    // the call. Throwing would cost every OTHER surface in the same round-trip its answer.
    return (
      contributed?.(request.surface, {
        userId,
        sessionId,
        payload: request.payload,
        signal,
        deadlineAtMs,
      }) ?? Promise.resolve([])
    )
  }
  const resolver = resolvers[request.surface as keyof InlineCompletionContextResolverMap] as (
    userId: string,
    sessionId: string,
    payload: unknown,
    signal?: AbortSignal,
    deadlineAtMs?: number,
  ) => Promise<readonly ContextContribution[]> | undefined
  return resolver?.(userId, sessionId, request.payload, signal, deadlineAtMs) ?? Promise.resolve([])
}

export function createInlineCompletionContextResolver(
  deps: InlineCompletionContextResolverDeps,
): SurfaceContextResolver {
  const resolvers = {
    chat: async (userId, sessionId, _payload, signal, deadlineAtMs) => {
      if (expired(signal, deadlineAtMs)) return []
      const detail = await deps.chatService
        .getInlineCompletionContext(userId, sessionId)
        .catch(() => null)
      if (!detail || expired(signal, deadlineAtMs)) return []
      const turns = detail.messages.flatMap((message) => {
        const payload = message.payload
        if (payload.isInternal || payload.uiOnly) return []
        const text = payload.content?.trim()
          ? payload.content
          : (payload.items ?? []).flatMap((item) => (isTextItem(item) ? [item.text] : [])).join(' ')
        if (!text.trim()) return []
        return [
          { role: payload.role === 'user' ? ('user' as const) : ('assistant' as const), text },
        ]
      })
      const digest = renderSessionDigest({ turns })
      if (!digest) return []
      return [
        {
          id: `conversation:${sessionId}`,
          providerId: 'localix.chat',
          providerVersion: '1',
          scope: 'session',
          kind: 'conversation',
          content: digest,
          priority: 1000,
          sensitivity: 'project',
        },
      ]
    },
  } satisfies InlineCompletionContextResolverMap

  return (userId, sessionId, request, signal, deadlineAtMs) =>
    dispatchInlineCompletionContext(
      resolvers,
      userId,
      sessionId,
      request,
      signal,
      deadlineAtMs,
      deps.contributedContext,
    )
}
