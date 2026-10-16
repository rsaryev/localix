/**
 * PINNING A MESSAGE: the person's way to keep something in the model's view however long the
 * conversation grows.
 *
 * A pin is message STATE, like a reaction, and rides `message.updated` for the same reason: the
 * client applies the row it is given, so the transcript and its pin marks cannot arrive out of
 * step. It changes nothing the model was already sent — a context checkpoint honours it (never
 * evicts or compresses a pinned message), and a pin placed on a message that already left the
 * view is re-sent in the next turn's runtime context (`model-view/pins.ts`).
 */
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import { publishMessageSnapshot } from '../runtime/message-persistence'

export interface MessagePinIo {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
}

/** Set or clear a message's pin; false when the message is gone or already in that state. */
export async function setMessagePinned(
  io: MessagePinIo,
  params: { userId: string; sessionId: string; messageId: string; pinned: boolean },
): Promise<boolean> {
  const message = await io.repo.getMessage(params.userId, params.sessionId, params.messageId)
  if (!message || (message.payload.pinned === true) === params.pinned) return false
  const at = io.now()
  const patch = { pinned: params.pinned ? (true as const) : undefined }
  const written = await io.repo.updateMessage(
    params.userId,
    params.sessionId,
    params.messageId,
    patch,
    at,
  )
  publishMessageSnapshot({
    streamRegistry: io.streamRegistry,
    userId: params.userId,
    sessionId: params.sessionId,
    messageId: params.messageId,
    payload: written?.payload ?? { ...message.payload, ...patch },
    createdAt: message.createdAt,
    updatedAt: at,
  })
  return true
}
