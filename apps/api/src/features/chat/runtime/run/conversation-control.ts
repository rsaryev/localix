import { createHash } from 'node:crypto'

import type { ConversationControlPort } from '../../../agent-core/tools/conversation-control'
import { enqueueTurnTickets, resolveTurnRecipients } from '../conversation-dispatch'
import { rosterLeadership } from '../conversation-strategy'
import { sessionExecutionContext } from '../execution-context'
import type { RunEnv, RunParams } from './types'
import { resolveConversationMember, updateConversationMembership } from './conversation-membership'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'
import { insertUiNote } from '../message-persistence'

export function createConversationControlPort(
  env: Pick<RunEnv, 'repo' | 'enqueueRun' | 'deps'> &
    Partial<Pick<RunEnv, 'state' | 'cancelAgentTurns'>>,
  params: RunParams,
): { finish: ConversationControlPort['finish']; completed: () => boolean } {
  let completed = false

  const finish: ConversationControlPort['finish'] = async (toolCallId, request) => {
    if (completed) throw new Error('conversation_control may be completed only once per turn')

    const nextHandles: string[] = []
    const membershipEnv = {
      repo: env.repo,
      deps: env.deps,
      // The speaking participant is the caller itself; it may remove others, not itself.
      ...(env.state
        ? {
            activeAgentId: (sessionId: string) =>
              env.state!.activeRunSessions.get(sessionId)?.agentId,
          }
        : {}),
      ...(env.cancelAgentTurns
        ? {
            cancelAgentTurn: (userId: string, sessionId: string, agentId: string) =>
              env.cancelAgentTurns!(userId, sessionId, { agentId }),
          }
        : {}),
    }
    const membership = await updateConversationMembership(membershipEnv, {
      userId: params.userId,
      sessionId: params.session.id,
      invite: request.invite,
      remove: request.remove,
      validate: (agents) => {
        for (const reference of request.next) {
          const member = resolveConversationMember(agents, reference)
          if (!member) {
            const available = agents
              .map((entry) => `@${entry.handle} (${entry.agentId})`)
              .join(', ')
            throw new Error(
              `Agent ${JSON.stringify(reference)} is unavailable. Available: ${available || 'none'}.`,
            )
          }
          if (member.agentId === params.scope.speakerAgentId) {
            throw new Error('The current speaker cannot schedule itself as next.')
          }
          if (!nextHandles.includes(member.handle)) nextHandles.push(member.handle)
        }
      },
    })
    const updated = membership.session

    // The chain is bounded: past the limit the floor goes back to the person instead of to
    // another participant, and the person is told why the conversation stopped here.
    const handoffDepth = (params.scope.handoffDepth ?? 0) + 1
    if (nextHandles.length > 0 && handoffDepth > MAX_HANDOFF_CHAIN) {
      const text = `The participants handed the floor to each other ${MAX_HANDOFF_CHAIN} times without hearing from you, so the conversation is back with you.`
      await insertUiNote({
        repo: env.repo,
        streamRegistry: env.deps.streamRegistry,
        now: () => new Date().toISOString(),
        userId: params.userId,
        sessionId: params.session.id,
        // Derived from the handing-off turn, so a retried call lands on the same row.
        messageId: `${params.assistantMessageId}:handoff-limit`,
        content: text,
        systemNotice: { kind: 'handoff_limit', tone: 'neutral', text },
      }).catch((error: unknown) => console.warn('[conversation] handoff notice failed', error))
      completed = true
      return {
        invited: membership.invited.map((agent) => `@${agent.name}`),
        removed: membership.removed.map((member) => `@${member.handle}`),
        next: [],
        stopped: `Handoff limit reached (${MAX_HANDOFF_CHAIN} in a row): nobody was queued; the conversation returns to the user.`,
      }
    }

    const recipients = await resolveTurnRecipients(
      updated,
      params.historyMessages,
      { kind: 'agent-request', from: params.scope.speakerAgentId, recipients: nextHandles },
      rosterLeadership(env.deps.listRegistryAgents, params.userId, updated.projectId),
    )
    // Hashed from the handing-off turn and call, so a retried tool call addresses the same slots.
    const slotId = (recipient: { agentId: string }) =>
      `conversation-control-${createHash('sha256')
        .update(JSON.stringify([params.assistantMessageId, toolCallId, recipient.agentId]))
        .digest('hex')}`
    await enqueueTurnTickets(env.enqueueRun, {
      userId: params.userId,
      session: updated,
      triggerMessageIds: [params.assistantMessageId],
      firstSlotId: params.assistantMessageId,
      recipients,
      slotId,
      scope: {
        conversationId: params.scope.conversationId ?? params.assistantMessageId,
        turnTrigger: { kind: 'colleague-request', messageIds: [params.assistantMessageId] },
        handoffDepth,
        executionContext: sessionExecutionContext(updated),
      },
    })

    completed = true
    return {
      invited: membership.invited.map((agent) => `@${agent.name}`),
      removed: membership.removed.map((member) => `@${member.handle}`),
      next: nextHandles.map((handle) => `@${handle}`),
    }
  }

  return { finish, completed: () => completed }
}
