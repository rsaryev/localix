/**
 * Two pending turns for the SAME participant become one — the rule, and its one side effect.
 *
 * A participant answers once per burst: a second address while the first is still waiting is
 * folded into it rather than queued behind it. The fold used to lose three things:
 *
 *   - it looked at every queued ticket, including one a drain had already LEASED; the store
 *     only updates `pending` rows, so the write threw and the new request vanished;
 *   - it kept the waiting ticket's scope and slot, so a newer request's model override, skill
 *     grants or profile were dropped, and the newer request's pre-created assistant slot was
 *     left empty in the transcript for good;
 *   - it wrote on every fold, even when nothing changed.
 *
 * So the rule is: the STRONGER request (the lower priority number; the newer one on a tie)
 * defines the run — its source and its scope — the reply lands in the NEWEST slot, which sits
 * after every message it answers, and the slot it supersedes is removed while still empty.
 */
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { ChatRepository } from '../../repository'
import type { SessionStreamRegistry } from '../session-stream-registry'

export interface TicketMerge {
  ticket: AgentTurnTicket
  priority: number
  /** False when the fold adds nothing: no store write, no publish. */
  changed: boolean
  /** An assistant slot no ticket points at any more, to retire if still empty. */
  supersededSlot?: string
}

export function mergeAgentTicket(
  waiting: { ticket: AgentTurnTicket; priority: number },
  incoming: { ticket: AgentTurnTicket; priority: number },
): TicketMerge {
  const incomingWins = incoming.priority <= waiting.priority
  const stronger = incomingWins ? incoming.ticket : waiting.ticket
  const triggerMessageIds = [
    ...new Set([...waiting.ticket.triggerMessageIds, ...incoming.ticket.triggerMessageIds]),
  ]
  const ticket: AgentTurnTicket = {
    speakerAgentId: waiting.ticket.speakerAgentId,
    assistantMessageId: incoming.ticket.assistantMessageId,
    triggerMessageIds,
    source: stronger.source,
    scope: stronger.scope,
  }
  const priority = Math.min(incoming.priority, waiting.priority)
  const slotMoved = ticket.assistantMessageId !== waiting.ticket.assistantMessageId
  const changed =
    slotMoved ||
    priority !== waiting.priority ||
    ticket.source !== waiting.ticket.source ||
    ticket.scope !== waiting.ticket.scope ||
    triggerMessageIds.length !== waiting.ticket.triggerMessageIds.length
  return {
    ticket,
    priority,
    changed,
    ...(slotMoved ? { supersededSlot: waiting.ticket.assistantMessageId } : {}),
  }
}

/**
 * Remove a superseded slot — only while it is still an empty placeholder. A slot that already
 * holds content or activity is evidence of work and is never deleted here.
 */
export async function retireSupersededSlot(
  deps: { repo: ChatRepository; streamRegistry: SessionStreamRegistry },
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<void> {
  const slot = await deps.repo.getMessage(userId, sessionId, messageId)
  if (slot?.payload.role !== 'assistant') return
  if (slot.payload.content || slot.payload.items?.length) return
  await deps.repo.deleteMessagesByIds(userId, sessionId, [messageId])
  deps.streamRegistry.publish(userId, sessionId, {
    type: 'message.removed',
    sessionId,
    messageId,
  })
}
