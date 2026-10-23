/**
 * A BOARD CARD WAS ASSIGNED TO THE PERSON — tell them, wherever they are.
 *
 * Agents never address the person with a mention: a question, decision or approval goes through
 * `ask`, which raises its own HITL card. What remains is a card handed to `@human` on the task
 * board — it blocks nothing, but it waits on them in a conversation they may not be looking at,
 * so it borrows the same surface: the stream frame, the attention item and the mini app hook.
 */
import type { AgentStreamEvent } from '../../contracts'
import type { AgentNotifications } from '../../../notifications/producers'

/** How much of the card travels in the notification. A banner is not a transcript. */
const NOTICE_CHARS = 280

/** A card in a chat now waits on the person. */
export interface HumanAssignment {
  sessionId: string
  /** The subject (the card) the person is pointed at. */
  messageId: string
  /** The handle of whoever assigned it; '' when no agent did. */
  from: string
  text: string
}

export interface HumanAssignmentIo {
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  /** The attention item (and its journal row and native notification) — the frame is only news. */
  notifications?: Pick<AgentNotifications, 'mentions'>
  /** External channels (plugins' `onHumanAssigned`). Fire-and-forget. */
  onHumanAssigned?: (event: HumanAssignment) => void
}

/** Tell the person: the stream frame, the attention item, the mini app hook. */
export function publishHumanAssignment(
  io: HumanAssignmentIo,
  userId: string,
  input: HumanAssignment,
): void {
  const text = input.text.trim()
  const notice = {
    ...input,
    text: text.length > NOTICE_CHARS ? `${text.slice(0, NOTICE_CHARS)}…` : text,
    mentionedAt: Date.now(),
  }
  io.streamRegistry.publish(userId, input.sessionId, { type: 'user.mentioned', ...notice })
  io.notifications?.mentions.mentioned({ userId, ...notice })
  io.onHumanAssigned?.({
    sessionId: notice.sessionId,
    messageId: notice.messageId,
    from: notice.from,
    text: notice.text,
  })
}
