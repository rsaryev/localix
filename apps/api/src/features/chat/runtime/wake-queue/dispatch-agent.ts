import { agentAuthor } from '../../../../db/author'
import type { SessionRecord } from '../../repository'
import { emptyAssistantPayload, toPersistedMessage } from '../message-envelope'
import { dispatchParams } from '../run-params'
import { dismissedRun, type RunCompletion, type RunExecutionOutcome } from '../run-outcome'
import type { WakeQueueContext } from '../wake-queue'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { TurnStart } from '../wake-queue-store-contracts'
import { withRoute } from '../../../../contracts/session-route'

/** Execution consumer: every turn of the conversation's agent uses this path, whoever produced it. */
export async function dispatchAgentTicket(
  input: {
    userId: string
    session: SessionRecord
    ticket: AgentTurnTicket
    completion?: RunCompletion
    /** Acknowledge the ticket; `starting` records the reply slot with the acknowledgement. */
    consume(starting?: TurnStart): Promise<void>
  },
  deps: Pick<WakeQueueContext, 'repo' | 'run' | 'streamRegistry' | 'now' | 'store'>,
): Promise<RunExecutionOutcome> {
  const { userId, session, ticket } = input
  const agent = session.agent
  if (!agent) {
    await input.consume()
    return dismissedRun('The session has no agent to answer this turn.')
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
  // A missing slot is recreated here, so a ticket whose turn was taken back must not reach this
  // line: rollback cancels the tickets answering or writing into what it deleted
  // (`service/branching-ops.ts`, `rollback`).
  if (!prior) {
    const message = toPersistedMessage(
      userId,
      session.id,
      emptyAssistantPayload(ticket.assistantMessageId, agentAuthor(agent.agentId)),
      deps.now(),
    )
    await deps.repo.insertMessage(message)
    deps.streamRegistry.publish(userId, session.id, {
      type: 'message.created',
      sessionId: session.id,
      message,
    })
  }
  // Acknowledged with the slot it fills: a crash before the run returns leaves that record for
  // boot recovery (`turn-starts.ts`), so the placeholder is never left empty forever.
  await input.consume({
    assistantMessageId: ticket.assistantMessageId,
    at: deps.now(),
  })
  const { modelOverride, effortOverride } = ticket.scope
  const runSession =
    modelOverride || effortOverride
      ? withRoute(session, {
          ...(modelOverride ? { modelId: modelOverride } : {}),
          ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
        })
      : session
  try {
    return await deps.run(
      dispatchParams(
        {
          userId,
          session: runSession,
          assistantMessageId: ticket.assistantMessageId,
          historyMessages: history.filter((message) => message.id !== ticket.assistantMessageId),
        },
        ticket.scope,
        input.completion,
      ),
    )
  } finally {
    await deps.store?.turnStarted?.(ticket.assistantMessageId).catch(() => undefined)
  }
}
