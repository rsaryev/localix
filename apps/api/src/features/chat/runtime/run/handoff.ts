/**
 * A PARTICIPANT ASKED THE PERSON — stamped on the row, read as a field.
 *
 * The person is not an executable queue address. This field is presentation and notification
 * metadata; it never mutates the agent queue.
 *
 * `payload.to` is that field: the participant this reply is for. Stamped at FINALIZE, before the
 * row's one write, never as a later patch — an edit to a committed row changes bytes the prompt
 * cache has already accepted, and in a multi-participant conversation the cache is what holds the
 * cost down.
 *
 * Deliberately NOT a human-in-the-loop request. `ask` blocks the run on an answer with a
 * deadline and an auto-answer behind it; a handback blocks nothing. The participant finishes its
 * message and the conversation goes quiet — if the person never answers, nothing is left hanging
 * and no timeout fires. What it borrows from HITL is the SURFACE, because the failure is the same one:
 * a question asked in a conversation nobody is looking at.
 */
import { USER_PARTICIPANT } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db'
import { HUMAN_HANDLE } from '@localixai/agent/agents'
import { mentionsHuman } from '../../agent-mentions'
import type { AgentStreamEvent } from '../../contracts'
import type { AgentNotifications } from '../../../notifications/producers'

/** How much of the question travels in the notification. A banner is not a transcript. */
const NOTICE_CHARS = 280

/** A reply's own text — the only evidence there is of who its author meant it for. */
const textOf = (payload: Pick<StoredMessagePayload, 'content'>): string =>
  typeof payload.content === 'string' ? payload.content : ''

/**
 * The payload to write, unchanged when this reply did not address `@human`.
 *
 * In a one-to-one chat too: every reply there is for the person, but an explicit `@human` is the
 * agent saying the chat now waits on them, which is worth a notification wherever they are. The
 * stored ref stays `user` — the persisted participant id of the person.
 */
export function withHandoff(payload: StoredMessagePayload): StoredMessagePayload {
  // Who answers next is `conversation-routing.ts`'s; this only stamps a row addressed to the person.
  if (!mentionsHuman(textOf(payload))) return payload
  return { ...payload, to: USER_PARTICIPANT, toSnapshot: { handle: HUMAN_HANDLE } }
}

/** Did the row that was just written hand the turn to the person? */
export function isHumanHandoff(payload: Pick<StoredMessagePayload, 'to'>): boolean {
  return payload.to === USER_PARTICIPANT
}

/** Something in a chat now waits on the person: an `@human` reply, or a card assigned to them. */
export interface HumanMention {
  sessionId: string
  /** The row (or other subject) the person is pointed at. */
  messageId: string
  /** The handle of whoever asked; '' when no agent did. */
  from: string
  text: string
}

export interface HumanMentionIo {
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  /** The attention item (and its journal row and native notification) — the frame is only news. */
  notifications?: Pick<AgentNotifications, 'mentions'>
  /** External channels (plugins' `onHumanMentioned`). Fire-and-forget. */
  onHumanMentioned?: (event: HumanMention) => void
}

/** Tell the person, wherever they are: the stream frame, the attention item, the plugin hook. */
export function publishHumanMention(io: HumanMentionIo, userId: string, input: HumanMention): void {
  const text = input.text.trim()
  const mention = {
    ...input,
    text: text.length > NOTICE_CHARS ? `${text.slice(0, NOTICE_CHARS)}…` : text,
    mentionedAt: Date.now(),
  }
  io.streamRegistry.publish(userId, input.sessionId, { type: 'user.mentioned', ...mention })
  io.notifications?.mentions.mentioned({ userId, ...mention })
  io.onHumanMentioned?.({
    sessionId: mention.sessionId,
    messageId: mention.messageId,
    from: mention.from,
    text: mention.text,
  })
}

/**
 * After the row is committed, not before: the frame carries a `messageId` the client follows
 * into the transcript, and a notification that arrives ahead of the message it points at is a
 * link to nothing.
 */
export function publishHumanHandoff(
  io: HumanMentionIo,
  args: { userId: string; sessionId: string; payload: StoredMessagePayload },
): void {
  publishHumanMention(io, args.userId, {
    sessionId: args.sessionId,
    messageId: args.payload.id,
    // The snapshot frozen at insert, like every other display of an author in a conversation: a
    // renamed agent must not retro-author the question it asked under its old name.
    from: args.payload.authorSnapshot?.handle ?? '',
    text: textOf(args.payload),
  })
}
