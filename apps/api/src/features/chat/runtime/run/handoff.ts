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
import { USER_MENTION_HANDLE } from '@localixai/agent/agents'
import { mentionsUser } from '../../agent-mentions'
import type { AgentStreamEvent } from '../../contracts'
import { isMultiParticipant } from '../../session-route'
import type { SessionRecord } from '../../repository'
import type { AgentNotifications } from '../../../notifications/producers'

/** How much of the question travels in the notification. A banner is not a transcript. */
const NOTICE_CHARS = 280

/** A reply's own text — the only evidence there is of who its author meant it for. */
const textOf = (payload: Pick<StoredMessagePayload, 'content'>): string =>
  typeof payload.content === 'string' ? payload.content : ''

/**
 * Does this reply name the person at all? The gate for TELLING them — which is a different
 * question from whether the round ends, and was the same one until a participant asked its
 * colleagues and the person in one breath.
 */
export function mentionsPerson(
  session: Pick<SessionRecord, 'agents'>,
  payload: Pick<StoredMessagePayload, 'content'>,
): boolean {
  return isMultiParticipant(session) && mentionsUser(textOf(payload))
}

/**
 * The payload to write, unchanged when this reply did not hand the conversation back.
 *
 * Only with several participants. A one-to-one chat has a single counterpart and every reply is already for the
 * person, so marking one of them would say nothing.
 */
export function withHandoff(
  session: Pick<SessionRecord, 'agents'>,
  payload: StoredMessagePayload,
): StoredMessagePayload {
  if (!isMultiParticipant(session)) return payload
  // Who answers next is `conversation-routing.ts`'s; this only stamps a row addressed to the person.
  if (!textOf(payload).trim() || !mentionsUser(textOf(payload))) return payload
  return toPerson(payload)
}

function toPerson(payload: StoredMessagePayload): StoredMessagePayload {
  return { ...payload, to: USER_PARTICIPANT, toSnapshot: { handle: USER_MENTION_HANDLE } }
}

/** Did the row that was just written hand the turn back to the person? */
export function isUserHandoff(payload: Pick<StoredMessagePayload, 'to'>): boolean {
  return payload.to === USER_PARTICIPANT
}

/**
 * Tell the person, wherever they are.
 *
 * After the row is committed, not before: the frame carries a `messageId` the client follows
 * into the transcript, and a notification that arrives ahead of the message it points at is a
 * link to nothing.
 */
export function publishUserHandoff(
  io: {
    streamRegistry: {
      publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
    }
    /** The attention item (and its journal row) for the same mention — the frame is only news. */
    notifications?: Pick<AgentNotifications, 'mentions'>
  },
  args: { userId: string; sessionId: string; payload: StoredMessagePayload },
): void {
  const { payload } = args
  const text = typeof payload.content === 'string' ? payload.content.trim() : ''
  const mention = {
    sessionId: args.sessionId,
    messageId: payload.id,
    // The snapshot frozen at insert, like every other display of an author in a conversation: a renamed
    // agent must not retro-author the question it asked under its old name.
    from: payload.authorSnapshot?.handle ?? '',
    text: text.length > NOTICE_CHARS ? `${text.slice(0, NOTICE_CHARS)}…` : text,
    mentionedAt: Date.now(),
  }
  io.streamRegistry.publish(args.userId, args.sessionId, { type: 'user.mentioned', ...mention })
  io.notifications?.mentions.mentioned({ userId: args.userId, ...mention })
}
