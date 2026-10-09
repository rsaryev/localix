import { randomUUID } from 'node:crypto'

import { ApiError } from '../../../lib/errors'
import { participantAgentId, USER_PARTICIPANT, type StoredMessagePayload } from '../../../db'
import { walkPathToRoot, indexMessageTree } from './branching'
import {
  persistAndPublishMessage,
  toPersistedMessage,
  emptyAssistantPayload,
  sessionAgent,
} from './message-builders'
import { logRunStartFailure } from './run-dispatch'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import { rootExecutionContext } from '../runtime/execution-context'
import { enqueueTurnTickets, resolveTurnRecipients } from '../runtime/conversation-dispatch'
import type { ToolSurface } from '@localixai/agent/agents'
import type { MessageMutationResponse, PersistedMessage, RollbackResponse } from '../contracts'

import {
  messageNotFound,
  withBranchMutation,
  type BranchingOpsContext,
} from './branching-ops-context'

export { messageNotFound, type BranchingOpsContext } from './branching-ops-context'
export { switchBranch, getBranchTree, checkoutBranch } from './branch-navigation'

/** Drop a message from the live view (it stays in the tree as a sibling branch). */
const publishMessageRemoved = (
  streamRegistry: SessionStreamRegistry,
  userId: string,
  sessionId: string,
  messageId: string,
) =>
  streamRegistry.publish(userId, sessionId, {
    type: 'message.removed',
    sessionId,
    messageId,
  })

/** Branch position {index,count} for a message from its tree siblings, or undefined when it has no alternatives. */
const branchMetaFor = async (
  repo: BranchingOpsContext['repo'],
  sessionId: string,
  messageId: string,
): Promise<{ index: number; count: number } | undefined> => {
  const siblings = await repo.siblings(sessionId, messageId)
  if (siblings.length <= 1) return undefined
  return { index: siblings.indexOf(messageId), count: siblings.length }
}

/**
 * Insert a freshly-forked sibling, attach its branch metadata, and publish the
 * `message.created` event with the metadata already filled in — so the live
 * event (which bypasses listMessages) shows the ◀ k/n ▶ switcher without a full
 * reload. Shared by regenerate (new assistant sibling) and editMessage (new
 * user sibling).
 */
const insertBranchSibling = async (
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  persisted: PersistedMessage,
): Promise<void> => {
  await ctx.repo.insertMessage(persisted) // parent_id = current leaf; advances leaf
  persisted.branch = await branchMetaFor(ctx.repo, sessionId, persisted.id)
  ctx.streamRegistry.publish(userId, sessionId, {
    type: 'message.created',
    sessionId,
    message: persisted,
  })
}

export async function regenerate(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  toolSurface?: ToolSurface,
  /** Refuse unless this is still the reply a regenerate would rewrite (a Retry from a row). */
  expectedMessageId?: string,
): Promise<MessageMutationResponse> {
  const { repo, runner, streamRegistry, now } = ctx
  return withBranchMutation(ctx, userId, sessionId, async (session) => {
    const messages = await repo.listMessages(userId, sessionId)
    const index = [...messages]
      .reverse()
      .findIndex((message) => message.payload.role === 'assistant')
    if (index === -1) {
      throw new ApiError(409, 'assistant_message_not_found', 'No assistant message to regenerate')
    }
    const assistantIndex = messages.length - 1 - index
    const assistant = messages[assistantIndex]
    // Decided HERE, under the lock that also serializes new turns: a client that checked first and
    // regenerated second left a window in which a new reply could land and be rewritten instead.
    if (expectedMessageId && assistant.id !== expectedMessageId) {
      const stillThere = messages.some((message) => message.id === expectedMessageId)
      throw stillThere
        ? new ApiError(409, 'regenerate_superseded', 'That reply is no longer the latest one')
        : new ApiError(409, 'regenerate_no_reply', 'That run left no reply to regenerate')
    }
    const historyMessages = messages.slice(0, assistantIndex)

    // Tree-native regenerate: rewind the branch tip to the message the
    // assistant answered (its tree parent), then append a NEW assistant
    // message as a sibling of the old one. The old assistant stays in the
    // tree as an alternative branch — switchBranch navigates between them.
    const parentId =
      historyMessages.length > 0 ? historyMessages[historyMessages.length - 1].id : null
    await repo.setSessionLeaf(sessionId, parentId)
    // The old assistant leaves the active branch (it stays in the tree as a
    // sibling, reachable via switchBranch). Drop it from the live view.
    publishMessageRemoved(streamRegistry, userId, sessionId, assistant.id)

    const originalAgentId = participantAgentId(assistant.payload.from)
    const [recipient] = await resolveTurnRecipients(
      session,
      historyMessages,
      {
        kind: 'runtime',
        ...(originalAgentId && session.agents.some((agent) => agent.agentId === originalAgentId)
          ? { recipient: originalAgentId }
          : {}),
      },
      runner.leadership(userId, session.projectId),
    )
    if (!recipient) throw new ApiError(400, 'session_party_empty', 'Choose an agent first')
    // The branch moved: anything still queued answers rows that are no longer on it.
    await runner.cancelAgentTurns(userId, sessionId)

    const ts = now()
    const asstPayload = emptyAssistantPayload(
      randomUUID(),
      sessionAgent(session, recipient.agentId),
    )
    await insertBranchSibling(
      ctx,
      userId,
      sessionId,
      toPersistedMessage(userId, sessionId, asstPayload, ts),
    )

    void enqueueTurnTickets(runner.enqueueRun, {
      userId,
      session,
      // The regenerated reply answers the row it now hangs under.
      triggerMessageIds: parentId ? [parentId] : [],
      firstSlotId: asstPayload.id,
      recipients: [recipient],
      scope: { executionContext: rootExecutionContext(toolSurface) },
    }).catch(logRunStartFailure('regenerate', sessionId))
    ctx.notifications?.runs.retried(userId, sessionId)

    return { sessionId, messageId: asstPayload.id }
  })
}

/**
 * Fork from any past user message: edit its text and branch. The original
 * message and everything after it stay in the tree as an alternative branch
 * (reachable via the message's branch switcher); a NEW user message with the
 * edited text is appended as a sibling and the agent runs from there.
 */
export async function editMessage(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  messageId: string,
  content: string,
  toolSurface?: ToolSurface,
): Promise<MessageMutationResponse> {
  const { repo, runner, streamRegistry, now } = ctx
  return withBranchMutation(ctx, userId, sessionId, async (session) => {
    // Resolve the target TREE-WIDE, not from the active-branch listMessages.
    // The UI can show (and offer "edit" on) a message that is not on the
    // current active leaf — e.g. right after switching to a sibling branch, or
    // when the live view briefly lags the server's leaf. Slicing the active
    // branch would 404 (target absent from that path) or, worse, replay a
    // FOREIGN branch's history. Branching from the target's OWN parent chain
    // makes editing any visible user message deterministic and self-consistent.
    const nodes = await repo.listMessageNodes(userId, sessionId)
    const target = nodes.find((n) => n.message.id === messageId)
    if (!target) throw messageNotFound()
    if (target.message.payload.role !== 'user') {
      throw new ApiError(409, 'edit_requires_user_message', 'Only user messages can be edited')
    }

    // Branch from the edited message's tree parent (its ancestor chain to root),
    // independent of where the active leaf currently points.
    const parentId = target.parentId
    const { parentById, msgById } = indexMessageTree(nodes)
    const historyIds = parentId ? walkPathToRoot(parentById, parentId) : []
    const historyMessages = historyIds
      .map((id) => msgById.get(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
    // Who answers is known before the branch moves: an edit nobody can answer must not leave
    // the conversation rewound to a question with no reply.
    const recipients = await resolveTurnRecipients(
      session,
      historyMessages,
      { kind: 'user-message', text: content },
      runner.leadership(userId, session.projectId),
    )
    const first = recipients[0]
    if (!first) throw new ApiError(400, 'session_party_empty', 'Choose an agent first')
    // The branch moves: anything still queued answers rows that are no longer on it.
    await runner.cancelAgentTurns(userId, sessionId)
    await repo.setSessionLeaf(sessionId, parentId)
    // The old message + its whole subtree leave the active branch (kept in the
    // tree as a sibling branch). Drop the leaf-ward path from the live view so
    // the UI swaps to the freshly forked branch.
    const oldBranchLeaf = await repo.descendToLeaf(sessionId, messageId)
    for (const id of walkPathToRoot(parentById, oldBranchLeaf)) {
      if (parentId && historyIds.includes(id)) continue // keep shared ancestors
      if (id === parentId) continue
      publishMessageRemoved(streamRegistry, userId, sessionId, id)
    }

    const ts = now()
    // Editing changes only the visible text. Reuse the already-resolved
    // attachment/context snapshot from the forked user turn so mutable providers
    // are not re-read and the new branch does not silently lose its context.
    // Invocation bindings are deliberately one-turn executable instructions;
    // replaying an old resolved command/skill after its text changed would apply
    // stale authority rather than immutable evidence.
    const retainedBindings = (target.message.payload.bindings ?? []).filter(
      (binding) => binding.kind !== 'invocation',
    )
    const userPayload: StoredMessagePayload = {
      id: randomUUID(),
      role: 'user',
      from: USER_PARTICIPANT,
      content,
      ...(retainedBindings.length > 0 ? { bindings: retainedBindings } : {}),
    }
    const userPersisted = toPersistedMessage(userId, sessionId, userPayload, ts)
    await insertBranchSibling(ctx, userId, sessionId, userPersisted)

    const asstPayload = emptyAssistantPayload(randomUUID(), sessionAgent(session, first.agentId))
    await persistAndPublishMessage(repo, streamRegistry, userId, sessionId, asstPayload, ts)

    void enqueueTurnTickets(runner.enqueueRun, {
      userId,
      session,
      triggerMessageIds: [userPersisted.id],
      firstSlotId: asstPayload.id,
      recipients,
      scope: {
        conversationId: userPayload.id,
        executionContext: rootExecutionContext(toolSurface),
      },
    }).catch(logRunStartFailure('edit', sessionId))

    return { sessionId, messageId: asstPayload.id }
  })
}

export async function rollback(
  ctx: BranchingOpsContext,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<RollbackResponse> {
  const { repo, streamRegistry } = ctx
  return withBranchMutation(ctx, userId, sessionId, async () => {
    const messages = await repo.listMessages(userId, sessionId)
    const index = messages.findIndex((message) => message.id === messageId)
    if (index === -1) {
      throw messageNotFound()
    }

    const target = messages[index]
    if (target.payload.role !== 'user') {
      throw new ApiError(
        409,
        'rollback_requires_user_message',
        'Rollback is only available for user messages',
      )
    }

    const ids = messages.slice(index).map((message) => message.id)
    await repo.deleteMessagesByIds(userId, sessionId, ids)
    // Anchor the active leaf at the rolled-back message's PARENT. deleteMessagesByIds
    // already repairs a deleted leaf, but it repairs to the highest-sequence survivor
    // — in a branched tree that can be an unrelated sibling branch, silently jumping
    // the user onto it. Setting the parent explicitly keeps rollback on the branch the
    // user rolled back, mirroring editMessage's leaf reset.
    await repo.setSessionLeaf(sessionId, index > 0 ? messages[index - 1].id : null)
    for (const id of ids) {
      publishMessageRemoved(streamRegistry, userId, sessionId, id)
    }

    return { restoredPrompt: target.payload.content ?? '' }
  })
}
