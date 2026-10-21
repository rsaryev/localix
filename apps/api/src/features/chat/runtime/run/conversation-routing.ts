/**
 * THE FLOOR AFTER A PARTICIPANT'S REPLY — decided by the host from what the reply says.
 *
 * A reply hands the floor by addressing colleagues with `@handle` (`conversation-addressing.ts`):
 * each addressed participant answers once, in order, reading the reply itself as its brief. An
 * available agent who is addressed but not here yet is invited first (`conversation-invite.ts`).
 *
 * Assignments and reports are told apart so the floor cannot ping-pong:
 *
 *   - addressing the colleague who handed you this turn is a REPORT to them;
 *   - a reply to an ASSIGNMENT that addresses nobody is a report too: the floor goes back to the
 *     colleague who asked, so finished work always reaches the one who gave it;
 *   - a reply to a REPORT that addresses nobody ends with the person;
 *   - a PASS (`skip_answer`: named, asked nothing) routes nowhere, not even back.
 *
 * The person is never addressed by a mention (a question for them goes through `ask`), so an
 * `@human` in a reply is plain text here. Every colleague hop counts against `MAX_HANDOFF_CHAIN`.
 *
 * In a group, group routing (`floor-advisor.ts`) corrects the plan where it is confident
 * (`floor-advice.ts`): an `@` that only credits a colleague assigns nobody, a handoff by name
 * without one reaches that colleague. A report back to whoever assigned the turn always stands.
 */
import { createHash } from 'node:crypto'

import { participantAgentId } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db'
import { addressedHandles } from '../../conversation-addressing'
import type { SessionRecord } from '../../repository'
import { MAX_HANDOFF_CHAIN } from '../../../../contracts/turn-budget'
import type { ConversationRecipient } from '../conversation-strategy'
import { rosterLeadership } from '../conversation-strategy'
import { enqueueTurnTickets, resolveTurnRecipients } from '../conversation-dispatch'
import { childExecutionContext, sessionExecutionContext } from '../execution-context'
import { insertUiNote } from '../message-persistence'
import { inviteAddressedAgents } from './conversation-invite'
import { adviseHandoff } from '../floor-advice'
import { conversationPolicy } from '../../policy/session-policy'
import type { RunEnv, RunParams } from './types'

type RoutingEnv = Pick<RunEnv, 'repo' | 'enqueueRun' | 'deps'> &
  Partial<Pick<RunEnv, 'state' | 'floorAdvisor'>>

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
  from: { requesters: readonly string[]; report: boolean },
): { reports: string[]; assignments: string[] } {
  const colleagues = session.agents.filter((member) => member.agentId !== speakerAgentId)
  const addressed = addressedHandles(
    text,
    colleagues.map((member) => member.handle),
  )
  const requesterHandles = colleagues
    .filter((member) => from.requesters.includes(member.agentId))
    .map((member) => member.handle)
  if (addressed.length === 0) {
    return { reports: from.report ? [] : requesterHandles, assignments: [] }
  }
  const isReport = (handle: string) => !from.report && requesterHandles.includes(handle)
  return {
    reports: addressed.filter(isReport),
    assignments: addressed.filter((handle) => !isReport(handle)),
  }
}

/**
 * The authority a colleague's turn runs under: the conversation's own, never more than the turn
 * that handed it the floor. A channel conversation stays a channel conversation — rebuilt from
 * the session record alone, a colleague's turn there ran as the root chat, admitted under the
 * `chat` host's rules and holding root authority the person's own channel turns never get.
 */
function handoffExecutionContext(params: RunParams, session: SessionRecord) {
  return params.scope.executionContext.invocation.kind === 'channel'
    ? childExecutionContext({ kind: 'channel' })
    : sessionExecutionContext(session)
}

/** The transcript before the settled reply, as it stands now; the run's own snapshot if unreadable. */
async function currentHistory(env: RoutingEnv, params: RunParams) {
  try {
    const rows = await env.repo.listMessages(params.userId, params.session.id)
    return rows.filter((row) => row.id !== params.assistantMessageId)
  } catch {
    return params.historyMessages
  }
}

/** Queue whoever the settled reply hands the floor to. Never throws: the reply is already saved. */
export async function routeConversationReply(
  env: RoutingEnv,
  params: RunParams,
  payload: Pick<StoredMessagePayload, 'content' | 'isInternal'> & { passed?: boolean },
): Promise<void> {
  // A pass hands the floor to nobody: whoever named this participant asked it nothing, so
  // there is no report to send back (`skip_answer`, LOCALIX-185).
  if (payload.passed) return
  try {
    const text = payload.isInternal ? '' : (payload.content ?? '')
    const room = conversationPolicy(params.session)
    if (!room.routesReplies) return
    // A lone agent hands the floor to nobody unless its reply tags someone to invite.
    if (!room.withColleagues && !text.includes('@')) return
    const current = await env.repo.getSession(params.userId, params.session.id)
    if (!current) return
    const session = await inviteAddressedAgents(
      {
        repo: env.repo,
        deps: env.deps,
        ...(env.state
          ? { activeAgentId: (id: string) => env.state!.activeRunSessions.get(id)?.agentId }
          : {}),
      },
      params.userId,
      current,
      text,
    )
    const speaker = params.scope.speakerAgentId
    const assistantMessageId = params.assistantMessageId
    const handoffDepth = (params.scope.handoffDepth ?? 0) + 1
    const grammar = planHandoff(session, speaker, text, trigger(params))
    // The grammar's plan, corrected where a confident decision model reads the reply otherwise:
    // an `@` that only credits a colleague, or a handoff by name without one. Not asked when its
    // answer cannot change the plan: a report that stands, or a chain already at its limit.
    const advisable =
      room.withColleagues &&
      env.floorAdvisor !== undefined &&
      handoffDepth <= MAX_HANDOFF_CHAIN &&
      (grammar.assignments.length > 0 || grammar.reports.length === 0)
    const advice = advisable
      ? await env.floorAdvisor!({
          userId: params.userId,
          sessionId: session.id,
          projectId: session.projectId,
        })({
          members: session.agents,
          // Read now, not the run's start: colleagues and the person may have spoken since.
          history: await currentHistory(env, params),
          authorAgentId: speaker,
          text,
        })
      : null
    const plan = adviseHandoff(grammar, advice)
    if (plan.reports.length + plan.assignments.length === 0) return

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
          executionContext: handoffExecutionContext(params, session),
        },
      })
    }
  } catch (error) {
    console.warn('[conversation] routing the reply failed', error)
  }
}
