/**
 * ONE TURN OF A CONVERSATION, ADDRESSED TO ITS AGENT.
 *
 * Five paths start a turn — a sent message, a queued one drained later, a slash command, an
 * edit and a regenerate. The order is fixed here:
 *
 *   resolve the recipient (`turnRecipient`) → the caller mints the first slot → one ticket.
 *
 * Minting the slot stays with the caller because the paths place it differently (a plain
 * append, a branch sibling, a durable queue pair).
 */
import type { SessionRecord } from '../repository'
import type { ConversationRecipient } from './conversation-strategy'
import type { EnqueueRun } from './agent-turn-ticket'
import type { RunScope } from './run-contract'
import type { RunCompletion } from './run-outcome'

/**
 * The addressed ticket of a turn. A caller that must wait for the answer passes a
 * `completion` and awaits ITS promise; waiting through the enqueue call instead would resolve
 * only when the run ends.
 */
export async function enqueueTurnTicket(
  enqueueRun: EnqueueRun,
  input: {
    userId: string
    session: SessionRecord
    /**
     * The rows that open this turn, which the reply anchors after. No history travels with the
     * ticket: the dispatcher reads the transcript when it runs.
     */
    triggerMessageIds: readonly string[]
    firstSlotId: string
    recipient: ConversationRecipient
    scope: Omit<RunScope, 'agentId'>
    /** Settled by the run of the ticket. */
    completion?: RunCompletion
  },
): Promise<void> {
  await enqueueRun(
    {
      userId: input.userId,
      session: input.session,
      assistantMessageId: input.firstSlotId,
      triggerMessageIds: input.triggerMessageIds,
      scope: input.scope,
      ...(input.completion ? { completion: input.completion } : {}),
    },
    input.recipient.source,
  )
}
