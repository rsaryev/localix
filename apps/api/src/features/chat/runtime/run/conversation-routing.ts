/**
 * THE FLOOR AFTER A PARTICIPANT'S REPLY — decided by the host from what the reply says.
 *
 * A turn hands the floor by calling `handoff` (`agent-core/tools/handoff.ts`): each named
 * participant answers once, in order, reading the reply itself as its brief. An available agent who
 * is named, or tagged with `@handle`, but not here yet is invited first and given the floor
 * (`conversation-invite.ts`). An `@handle` of someone already here is only a link: it never routes.
 *
 * Assignments and reports are told apart so the floor cannot ping-pong:
 *
 *   - handing off to the colleague who handed you this turn is a REPORT to them;
 *   - a reply to an ASSIGNMENT with no handoff is a report too: the floor goes back to the
 *     colleague who asked, so finished work always reaches the one who gave it;
 *   - a reply to a REPORT with no handoff ends with the person.
 *
 * Addressing `@user` hands the floor back to the person as well. Every colleague hop counts
 * against `MAX_HANDOFF_CHAIN`.
 */
import { createHash } from 'node:crypto'

import { participantAgentId } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db'
import { mentionsUser } from '../../agent-mentions'
import type { SessionRecord } from '../../repository'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'
import type { ConversationRecipient } from '../conversation-strategy'
import { rosterLeadership } from '../conversation-strategy'
import { enqueueTurnTickets, resolveTurnRecipients } from '../conversation-dispatch'
import { sessionExecutionContext } from '../execution-context'
import { insertUiNote } from '../message-persistence'
import { inviteHandles, taggedNewcomers } from './conversation-invite'
import type { RunEnv, RunParams } from './types'

type RoutingEnv = Pick<RunEnv, 'repo' | 'enqueueRun' | 'deps'> & Partial<Pick<RunEnv, 'state'>>

/** The colleagues whose request started this turn, and whether that request was a report. */
function trigger(params: RunParams): { requesters: string[]; report: boolean } {
  const turnTrigger = params.scope.turnTrigger
  if (turnTrigger?.kind !== 'colleague-request') return { requesters: [], report: false }
  const ids = new Set(turnTrigger.messageIds)
  const authors = params.historyMessages
    .filter((message) => ids.has(message.id))
    .map((message) => participantAgentId(message.payload.from))
  return {
    requesters: [...new Set(authors)].filter(
      (agentId): agentId is string => agentId !== null && agentId !== params.scope.speakerAgentId,
    ),
    report: turnTrigger.report === true,
  }
}

/** Addressed colleagues split into reports (back to whoever assigned this turn) and assignments. */
export function planHandoff(
  session: Pick<SessionRecord, 'agents'>,
  speakerAgentId: string,
  text: string,
  handoffs: readonly string[],
  from: { requesters: readonly string[]; report: boolean },
): { reports: string[]; assignments: string[] } {
  const colleagues = session.agents.filter((member) => member.agentId !== speakerAgentId)
  const handles = new Set(colleagues.map((member) => member.handle))
  const addressed = handoffs.filter((handle) => handles.has(handle))
  const requesterHandles = colleagues
    .filter((member) => from.requesters.includes(member.agentId))
    .map((member) => member.handle)
  if (addressed.length === 0) {
    const reportBack = !from.report && !mentionsUser(text)
    return { reports: reportBack ? requesterHandles : [], assignments: [] }
  }
  const isReport = (handle: string) => !from.report && requesterHandles.includes(handle)
  return {
    reports: addressed.filter(isReport),
    assignments: addressed.filter((handle) => !isReport(handle)),
  }
}

/** Queue whoever the settled reply hands the floor to. Never throws: the reply is already saved. */
export async function routeConversationReply(
  env: RoutingEnv,
  params: RunParams,
  payload: Pick<StoredMessagePayload, 'content' | 'isInternal'> & { handoffs?: readonly string[] },
): Promise<void> {
  try {
    const text = payload.isInternal ? '' : (payload.content ?? '')
    // A lone agent hands the floor to nobody unless it called `handoff` or tagged someone to invite.
    if (params.session.agents.length <= 1 && !payload.handoffs?.length && !text.includes('@'))
      return
    const current = await env.repo.getSession(params.userId, params.session.id)
    if (!current) return
    const inviteEnv = {
      repo: env.repo,
      deps: env.deps,
      ...(env.state
        ? { activeAgentId: (id: string) => env.state!.activeRunSessions.get(id)?.agentId }
        : {}),
    }
    // Tagging an agent who is not here brings it in with the floor, as it always did.
    const tagged = await taggedNewcomers(inviteEnv, params.userId, current, text)
    const handoffs = payload.isInternal
      ? []
      : [...new Set([...(payload.handoffs ?? []), ...tagged])]
    const session = await inviteHandles(inviteEnv, params.userId, current, handoffs)
    const speaker = params.scope.speakerAgentId
    const plan = planHandoff(session, speaker, text, handoffs, trigger(params))
    if (plan.reports.length + plan.assignments.length === 0) return

    const assistantMessageId = params.assistantMessageId
    const handoffDepth = (params.scope.handoffDepth ?? 0) + 1
    if (handoffDepth > MAX_HANDOFF_CHAIN) {
      const notice = `The participants handed the floor to each other ${MAX_HANDOFF_CHAIN} times without hearing from you, so the conversation is back with you.`
      await insertUiNote({
        repo: env.repo,
        streamRegistry: env.deps.streamRegistry,
        now: () => new Date().toISOString(),
        userId: params.userId,
        sessionId: session.id,
        // Derived from the handing-off turn, so a retried finalize lands on the same row.
        messageId: `${assistantMessageId}:handoff-limit`,
        content: notice,
        systemNotice: { kind: 'handoff_limit', tone: 'neutral', text: notice },
      })
      return
    }

    const priorities = rosterLeadership(
      env.deps.listRegistryAgents,
      params.userId,
      session.projectId,
    )
    const resolve = (handles: string[]): Promise<ConversationRecipient[]> =>
      handles.length
        ? resolveTurnRecipients(
            session,
            params.historyMessages,
            { kind: 'agent-request', from: speaker, recipients: handles },
            priorities,
          )
        : Promise.resolve([])
    // Hashed from the handing-off reply, so a retried finalize addresses the same slots.
    const slotId = (recipient: { agentId: string }) =>
      `handoff-${createHash('sha256')
        .update(JSON.stringify([assistantMessageId, recipient.agentId]))
        .digest('hex')}`
    for (const [handles, report] of [
      [plan.reports, true],
      [plan.assignments, false],
    ] as const) {
      const recipients = await resolve([...handles])
      if (recipients.length === 0) continue
      await enqueueTurnTickets(env.enqueueRun, {
        userId: params.userId,
        session,
        triggerMessageIds: [assistantMessageId],
        firstSlotId: assistantMessageId,
        recipients,
        slotId,
        scope: {
          conversationId: params.scope.conversationId ?? assistantMessageId,
          turnTrigger: {
            kind: 'colleague-request',
            messageIds: [assistantMessageId],
            ...(report ? { report: true } : {}),
          },
          handoffDepth,
          executionContext: sessionExecutionContext(session),
        },
      })
    }
  } catch (error) {
    console.warn('[conversation] routing the reply failed', error)
  }
}
