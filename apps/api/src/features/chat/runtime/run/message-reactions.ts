/**
 * PUTTING A MARK ON A MESSAGE.
 *
 * Reactions are message state written through one repository path. Keeping add/remove and
 * publication together prevents the transcript and its reaction chips from diverging.
 *
 * IDEMPOTENT per (message, emoji). A reaction is not an event in the conversation: a
 * model that retries its turn, or a person who double-taps, has reacted once. That also makes
 * the write safe to repeat after a failure, which is why it needs no lease.
 *
 * It rides `message.updated`, the opcode that already carries a whole message, rather than an
 * opcode of its own: the client applies the row it is given, so the transcript and the marks on
 * it can never arrive out of step.
 */
import { USER_AUTHOR, type StoredMessagePayload } from '../../../../db'
import type { ChatRepository } from '../../repository'
import type { SessionStreamRegistry } from '../session-stream-registry'
import { publishMessageSnapshot } from '../message-persistence'

export interface MessageReactionIo {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
}

/** The reactions a message would have after the person marks it with `emoji`; null when unchanged. */
export function withReaction(
  payload: StoredMessagePayload,
  emoji: string,
  at: string,
): StoredMessagePayload['reactions'] | null {
  const current = payload.reactions ?? []
  if (current.some((r) => r.emoji === emoji)) return null
  return [...current, { emoji, from: USER_AUTHOR, at }]
}

/** The reactions a message would have after the person takes `emoji` back; null when unchanged. */
export function withoutReaction(
  payload: StoredMessagePayload,
  emoji: string,
): StoredMessagePayload['reactions'] | null {
  const current = payload.reactions ?? []
  const next = current.filter((r) => r.emoji !== emoji)
  return next.length === current.length ? null : next
}

/**
 * Apply a reaction change to one message and publish the result.
 *
 * Returns false when the message is gone or the change is a no-op, so a caller can tell "did
 * nothing" from "did something" without reading the row again. Never throws for a missing
 * message: reacting to a message that was rolled back is a race, not an error.
 */
export async function setMessageReaction(
  io: MessageReactionIo,
  params: {
    userId: string
    sessionId: string
    messageId: string
    emoji: string
    /** Remove instead of add — the same gesture pressed a second time. */
    remove?: boolean
  },
): Promise<boolean> {
  const message = await io.repo.getMessage(params.userId, params.sessionId, params.messageId)
  if (!message) return false
  const at = io.now()
  const reactions = params.remove
    ? withoutReaction(message.payload, params.emoji)
    : withReaction(message.payload, params.emoji, at)
  if (!reactions) return false
  const written = await io.repo.updateMessage(
    params.userId,
    params.sessionId,
    params.messageId,
    { reactions },
    at,
  )
  publishMessageSnapshot({
    streamRegistry: io.streamRegistry,
    userId: params.userId,
    sessionId: params.sessionId,
    messageId: params.messageId,
    payload: written?.payload ?? { ...message.payload, reactions },
    createdAt: message.createdAt,
    updatedAt: at,
  })
  return true
}
