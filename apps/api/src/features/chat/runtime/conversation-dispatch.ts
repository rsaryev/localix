/**
 * ONE TURN OF A CONVERSATION, FANNED OUT TO THE PARTICIPANTS WHO ANSWER IT.
 *
 * Six paths start a turn — a sent message, a queued one drained later, a slash command, an
 * edit, a regenerate, and a participant handing the floor on — and each used to spell the
 * fan-out itself. The copies drifted in ways a transcript shows:
 *
 *   - the command and edit paths asked the strategy for recipients with the NEW user row
 *     already in the history, so "whoever last answered the user" never matched and the turn
 *     went to the least-recent participant instead;
 *   - they threw "choose an agent" AFTER persisting the user row, leaving a question nobody
 *     would answer;
 *   - only the send path let a person's message supersede a colleague chain in flight.
 *
 * So the order is fixed here, and each step is one function:
 *
 *   resolve recipients (history BEFORE the trigger) → supersede colleague chains (a person
 *   spoke) → the caller mints the first slot → one ticket per recipient.
 *
 * Minting the slot stays with the caller because the six paths place it differently (a plain
 * append, a branch sibling, a durable queue pair); the slot IDS of every recipient after the
 * first are this module's rule, so a retried fan-out addresses the same rows.
 */
import { participantAgentId } from '../../../db/participant'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import {
  resolveConversationStrategy,
  type AgentTurnSource,
  type ConversationEvent,
  type ConversationRecipient,
  type LeadershipPriorities,
} from './conversation-strategy'
import type { EnqueueRun } from './agent-turn-ticket'
import type { RunScope } from './run-contract'
import type { RunCompletion } from './run-outcome'

/**
 * Who answers this turn. `historyBeforeTrigger` must NOT contain the row that opens the turn:
 * the strategy reads the transcript's last row as "who answered the user last".
 */
export function resolveTurnRecipients(
  session: Pick<SessionRecord, 'agents'>,
  historyBeforeTrigger: readonly PersistedMessage[],
  event: ConversationEvent,
  priorities: LeadershipPriorities,
): Promise<ConversationRecipient[]> {
  const context = { session, history: historyBeforeTrigger, priorities }
  return resolveConversationStrategy(context).recipients(context, event)
}

/**
 * THE EVENT A QUEUED TURN IS ROUTED AS — the one rule the drain applies and a host that records
 * wakes can replay.
 *
 * The person's typed message is routed by its text. A machine wake is routed by the runtime
 * rule: its named participant (`routedTo`), else the least recently dispatched one. A wake that
 * carries the PERSON'S words (`addressedAs`, a plan approval's `@handle`) is neither: routed by the
 * runtime rule, "@backend, take this" reached whoever was least recent and `@all` reached one
 * agent. So it is routed as the message those words are — mentions, `@all`, and the strategy's
 * default answerer when they name nobody.
 */
export function queuedTurnEvent(
  turn: { internal: boolean; content: string; addressedAs?: string },
  routedTo: string | undefined,
): ConversationEvent {
  if (!turn.internal) return { kind: 'user-message', text: turn.content }
  if (turn.addressedAs !== undefined) return { kind: 'user-message', text: turn.addressedAs }
  return {
    kind: 'runtime',
    recipient: routedTo ? (participantAgentId(routedTo) ?? undefined) : undefined,
  }
}

/**
 * The participant a person's unaddressed words go to right now — the one a command that names
 * nobody (`/model`, `/reasoning`, a forked skill) is about.
 *
 * Those commands used to take the FIRST participant, so in a conversation where @qa had been
 * answering, `/model` quietly changed @lead's model. The strategy already answers "who replies
 * to an unaddressed message", so this asks it rather than keeping a second rule.
 */
export async function speakingParticipant(
  session: Pick<SessionRecord, 'agents'>,
  history: readonly PersistedMessage[],
  priorities: LeadershipPriorities,
): Promise<SessionRecord['agents'][number] | undefined> {
  if (session.agents.length <= 1) return session.agents[0]
  const [recipient] = await resolveTurnRecipients(
    session,
    history,
    { kind: 'user-message', text: '' },
    priorities,
  )
  return session.agents.find((member) => member.agentId === recipient?.agentId) ?? session.agents[0]
}

/**
 * A person spoke: a colleague chain queued before this message is answering a conversation
 * that has moved on, so it is dropped. Turns that answer the PERSON — addressed, default,
 * broadcast or runtime deliveries — are owed to them and stay.
 */
export function supersedeColleagueChains(
  cancel: (userId: string, sessionId: string, filter: { source: AgentTurnSource }) => Promise<void>,
  userId: string,
  sessionId: string,
): Promise<void> {
  return cancel(userId, sessionId, { source: 'agent-request' })
}

/** The first recipient answers into the pre-minted slot; each later one gets a derived id. */
export function recipientSlotId(firstSlotId: string, index: number, agentId: string): string {
  return index === 0 ? firstSlotId : `${firstSlotId}-${agentId}`
}

/**
 * One addressed ticket per recipient, in order. Sequential on purpose: each admission is
 * durable before the next, so an interrupted fan-out resumes with the same slot ids and cannot
 * duplicate a ticket.
 *
 * A caller that must wait for the answer passes a `completion` and awaits ITS promise. Waiting
 * through the enqueue call instead would resolve only when the run ends, and a sequential
 * fan-out would then admit the second recipient after the first had finished speaking.
 */
export async function enqueueTurnTickets(
  enqueueRun: EnqueueRun,
  input: {
    userId: string
    session: SessionRecord
    /**
     * The rows that open this turn, which the reply anchors after. No history travels with the
     * tickets: the dispatcher reads the transcript when each one runs.
     */
    triggerMessageIds: readonly string[]
    firstSlotId: string
    recipients: readonly ConversationRecipient[]
    scope: Omit<RunScope, 'speakerAgentId'>
    /** Settled by the first recipient's run; later ones run detached. */
    completion?: RunCompletion
    slotId?: (recipient: ConversationRecipient, index: number) => string
  },
): Promise<void> {
  for (const [index, recipient] of input.recipients.entries()) {
    const completion = index === 0 ? input.completion : undefined
    await enqueueRun(
      {
        userId: input.userId,
        session: input.session,
        assistantMessageId:
          input.slotId?.(recipient, index) ??
          recipientSlotId(input.firstSlotId, index, recipient.agentId),
        triggerMessageIds: input.triggerMessageIds,
        scope: { ...input.scope, speakerAgentId: recipient.agentId },
        ...(completion ? { completion } : {}),
      },
      recipient.source,
    )
  }
}
