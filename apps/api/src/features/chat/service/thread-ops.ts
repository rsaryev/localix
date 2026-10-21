import { InvalidRequestError, NotFoundError } from '../../../lib/domain-errors'
import { agentRoute, chosenRoute, sessionRoute } from '../../../contracts/session-route'
import { participantAgentId } from '../../../db/participant'
import { randomUUID } from 'node:crypto'

import { sessionAgent, toPersistedMessage } from './message-builders'
import * as sessionLifecycle from './session-lifecycle'
import type { SessionLifecycleCtx } from './session-lifecycle-contracts'
import type { createChatRepository, SessionRecord } from '../repository'
import type { SessionDetail } from '../contracts'

/** Closure values the thread operations need from createChatService. */
export interface ThreadOpsContext {
  repo: ReturnType<typeof createChatRepository>
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  getSessionDetail: (userId: string, id: string) => Promise<SessionDetail>
  sessionLifecycleCtx: SessionLifecycleCtx
}

/**
 * Open (or reopen) the conversation THREAD anchored to one assistant message —
 * a focused side-conversation you can dive into without derailing the main chat.
 * It is a normal child chat (so the agent replies), keyed by
 * `message-thread:<messageId>` so the SAME thread reopens on re-click, parented
 * under the host session (→ nests in the sidebar) and seeded with the anchored
 * message so the model knows what "this" refers to. Reuses the session model
 * wholesale — no bespoke thread store.
 */
export async function openMessageThread(
  ctx: ThreadOpsContext,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<SessionDetail> {
  const parent = await ctx.requireSession(userId, sessionId)
  const key = `message-thread:${messageId}`
  const existing = await ctx.repo.findSessionByParentAndSource(userId, sessionId, key)
  if (existing) return ctx.getSessionDetail(userId, existing.id)

  const anchor = await ctx.repo.getMessage(userId, sessionId, messageId)
  if (!anchor) {
    throw new NotFoundError(
      'message_not_found',
      `Message ${messageId} not found in session ${sessionId}`,
    )
  }
  if (anchor.payload.role !== 'assistant') {
    throw new InvalidRequestError(
      'message_not_threadable',
      'Only assistant messages can be opened as threads',
    )
  }
  const anchorText = typeof anchor.payload.content === 'string' ? anchor.payload.content : ''

  // A thread continues with the participant who WROTE the anchored message: its route, its seat,
  // its authorship of the opener. It used to take the first participant for all three, so a
  // thread opened on @qa's reply was answered — and "written" — by @lead.
  const authorId = anchor.payload.from ? participantAgentId(anchor.payload.from) : null
  const author = authorId ? agentRoute(parent, authorId) : undefined
  const threadRoute = chosenRoute(author ?? sessionRoute(parent))
  const titleSeed = anchorText.trim().replace(/\s+/g, ' ')
  const title = titleSeed ? `Thread: ${titleSeed.slice(0, 60)}` : 'Thread'
  const created = await sessionLifecycle.createSession(ctx.sessionLifecycleCtx, userId, {
    title,
    parentSessionId: sessionId,
    projectId: parent.projectId,
    ...(author ? { agents: [{ agentId: author.agentId }] } : {}),
    // Only what the parent CHOSE travels into the thread (`chosenRoute`). A parent following
    // its project or the agent's card hands its thread a blank seat, which resolves to the same
    // model today and keeps following it tomorrow. The effort always travels: it is the dial
    // for the task, and a thread is part of that task.
    providerConnectionId: threadRoute.providerConnectionId,
    modelId: threadRoute.modelId,
    reasoningEffort: threadRoute.reasoningEffort,
    sourceToolCallId: key,
    provenance: { kind: 'thread', parentSessionId: sessionId, phase: 'message' },
  })
  // Seed the anchored assistant message as the thread's opener so it reads like a
  // reply thread (and gives the model the context it branches from).
  if (anchorText) {
    const ts = ctx.now()
    const seedId = randomUUID()
    const seed = toPersistedMessage(
      userId,
      created.id,
      {
        id: seedId,
        role: 'assistant',
        from: sessionAgent(parent, author?.agentId),
        content: anchorText,
      },
      ts,
    )
    await ctx.repo.insertMessage(seed)
  }
  return ctx.getSessionDetail(userId, created.id)
}
