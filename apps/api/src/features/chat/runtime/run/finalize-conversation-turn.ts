/**
 * EVERYTHING ABOUT THIS ROW THAT IS TRUE BECAUSE THE CONVERSATION HAS SEVERAL PARTICIPANTS.
 *
 * Three facts settle together at the end of a participant's turn, and they have to settle in this
 * order or the transcript contradicts itself:
 *
 *   1. did the participant address the PERSON → stamped on the row before it is written
 *   2. did the participant say NOTHING        → the row is hidden rather than filled
 *   3. if it asked and is visible             → the person is told, wherever they are
 *
 * Composed here rather than inline in `finalize.ts` because the ordering is the argument. The
 * stamp must precede the write (a later patch would rewrite bytes the prompt cache has already
 * accepted); the notification must follow it (the frame carries a message id the client follows
 * into the transcript, so one that outran its own message would link to nothing); and a hidden
 * row must raise nothing at all, because a question nobody can open is not a question.
 *
 * `finalize.ts` decides whether the turn was silent — it needs that answer earlier, to keep its
 * empty-content fallback from announcing a failure for a participant that behaved as asked — so
 * that one verdict comes in as an argument rather than being computed twice.
 */
import type { StoredMessagePayload } from '../../../../db'
import type { SessionRecord } from '../../repository'
import { settleConversationTurn, type ConversationSilenceIo } from './conversation-silence'
import { mentionsPerson, publishUserHandoff, withHandoff } from './handoff'

export async function settleConversationRow(
  io: ConversationSilenceIo & Parameters<typeof publishUserHandoff>[0],
  args: {
    silent: boolean
    userId: string
    session: Pick<SessionRecord, 'id' | 'agents'>
    payload: StoredMessagePayload
  },
): Promise<void> {
  const { silent, userId, session, payload } = args
  const settled = withHandoff(session, payload)
  await settleConversationTurn(io, { silent, userId, sessionId: session.id, payload: settled })
  // TOLD whenever they are named, not only when the round stops for them. The two used to be one
  // condition, and a participant that asked the person AND its colleagues in one message had to be
  // either announced-and-blocking or silent-and-continuing — so the mention that read as a
  // handback took the round with it.
  if (!silent && mentionsPerson(session, settled)) {
    publishUserHandoff(io, { userId, sessionId: session.id, payload: settled })
  }
}
