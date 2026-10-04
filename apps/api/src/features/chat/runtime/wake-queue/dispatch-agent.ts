import { agentParticipant } from '../../../../db/participant'
import type { SessionRecord } from '../../repository'
import { emptyAssistantPayload, toPersistedMessage } from '../message-envelope'
import { dispatchParams } from '../run-params'
import type { RunCompletion, RunExecutionOutcome } from '../run-outcome'
import type { WakeQueueContext } from '../wake-queue'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import { withRoute } from '../../session-route'

/** Execution consumer: every participant uses this path, irrespective of its producer. */
export async function dispatchAgentTicket(
  input: {
    userId: string
    session: SessionRecord
    ticket: AgentTurnTicket
    completion?: RunCompletion
    consume(): Promise<void>
  },
  deps: Pick<WakeQueueContext, 'repo' | 'run' | 'streamRegistry' | 'now'>,
): Promise<RunExecutionOutcome> {
  const { userId, session, ticket } = input
  const member = session.agents.find((entry) => entry.agentId === ticket.speakerAgentId)
  if (!member) {
    await input.consume()
    return {
      status: 'failed',
      kind: 'dismissed',
      message: 'The addressed participant has left.',
      retryable: false,
      rateLimited: false,
    }
  }
  const history = await deps.repo.listMessages(userId, session.id)
  const prior = history.find((message) => message.id === ticket.assistantMessageId)
  // Never replay tools after an uncertain interruption. Existing activity is evidence that
  // this ticket began execution; only an empty, pre-created UI placeholder is safe to start.
  if (prior && (prior.payload.content || prior.payload.items?.length || prior.payload.isInternal)) {
    await input.consume()
    return {
      status: 'delegated',
      message: 'This execution already produced activity; it was not repeated.',
    }
  }
  if (!prior) {
    const message = toPersistedMessage(
      userId,
      session.id,
      {
        ...emptyAssistantPayload(ticket.assistantMessageId, agentParticipant(member.agentId)),
        authorSnapshot: { handle: member.handle },
      },
      deps.now(),
    )
    await deps.repo.insertMessage(message)
    deps.streamRegistry.publish(userId, session.id, {
      type: 'message.created',
      sessionId: session.id,
      message,
    })
  }
  await input.consume()
  const runSession = ticket.scope.modelOverride
    ? withRoute(session, { modelId: ticket.scope.modelOverride }, member.agentId)
    : session
  return deps.run(
    dispatchParams(
      {
        userId,
        session: runSession,
        assistantMessageId: ticket.assistantMessageId,
        historyMessages: history.filter((message) => message.id !== ticket.assistantMessageId),
      },
      {
        ...ticket.scope,
        speakerAgentId: member.agentId,
        ...(ticket.source === 'agent-request'
          ? {
              turnTrigger: {
                kind: 'colleague-request' as const,
                messageIds: ticket.triggerMessageIds,
              },
            }
          : {}),
      },
      input.completion,
    ),
  )
}
