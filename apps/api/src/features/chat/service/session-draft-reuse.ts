/**
 * FIND-OR-CREATE the chat a landing opens.
 *
 * The neutral home, a launch and a window leaving a dead project all need *a* chat to show, not
 * a new one. Every restored workspace window lands at the same moment, so a plain create per
 * window left one empty "New Chat" each — twelve windows, twelve drafts within 130 ms, and one
 * more per window on every launch.
 *
 * Here the landing reuses the project's newest untouched chat with the same participant. The
 * look-up and the creation run as one step per user: concurrent landings queue behind each
 * other, so the first one creates and every later one finds that chat. The API is the single
 * writer of its database, which is what makes an in-process queue a sufficient serialization.
 * The New chat gesture never comes through here — it always asks for a new conversation.
 */
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { ApiError } from '../../../lib/errors'
import type { SessionDetail } from '../contracts'
import { DEFAULT_TITLE } from './context'
import { createSession } from './session-birth'
import type { CreateSessionInput, SessionLifecycleCtx } from './session-lifecycle-contracts'

export function createDraftReuse(ctx: SessionLifecycleCtx) {
  const tails = new Map<string, Promise<unknown>>()
  const serialized = <T>(userId: string, run: () => Promise<T>): Promise<T> => {
    const previous = tails.get(userId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(run)
    tails.set(userId, next)
    void next
      .catch(() => undefined)
      .finally(() => {
        if (tails.get(userId) === next) tails.delete(userId)
      })
    return next
  }

  return (userId: string, input: CreateSessionInput): Promise<SessionDetail> => {
    const { reuseEmptyDraft: _reuse, ...create } = input
    const agentId = reusableParticipant(create)
    if (!agentId || !ctx.repo.findEmptyDraft) return createSession(ctx, userId, create)
    const findEmptyDraft = ctx.repo.findEmptyDraft
    return serialized(userId, async () => {
      const projectId = create.projectId ?? (await ctx.resolveDefaultProjectId(userId))
      // A soft-deleted project keeps its rows; never hand one of its drafts to a landing.
      if (create.projectId && ctx.projectExists && !(await ctx.projectExists(userId, projectId))) {
        throw new ApiError(404, 'project_not_found', 'Project not found')
      }
      const existing = await findEmptyDraft(userId, projectId, agentId, DEFAULT_TITLE)
      if (existing) return ctx.getSessionDetail(userId, existing)
      return createSession(ctx, userId, { ...create, projectId })
    })
  }
}

/**
 * The one participant a reusable draft must have, or null when the request is not a plain
 * landing (a title, a group, a stated mode or route, a child or an external CLI is a specific chat).
 */
function reusableParticipant(input: CreateSessionInput): string | null {
  if (
    (input.title !== undefined && input.title !== DEFAULT_TITLE) ||
    input.parentSessionId ||
    (input.sessionKind ?? 'chat') !== 'chat' ||
    input.externalAgentProvider ||
    input.externalAgentSessionKey ||
    input.providerConnectionId ||
    input.modelId ||
    input.reasoningEffort ||
    input.goal ||
    input.previousTopicSummary ||
    input.conversationMode !== undefined ||
    (input.agents?.length ?? 0) > 1
  ) {
    return null
  }
  const [agent] = input.agents ?? []
  if (agent && (!agent.agentId || agent.modelId || agent.providerConnectionId)) return null
  return agent?.agentId ?? DEFAULT_AGENT_ID
}
