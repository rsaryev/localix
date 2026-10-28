import type { MessageBinding } from '@/shared/api/contracts'
import { makeOptimisticPair } from './optimisticPair'
import { patchSessionById } from './sessionListHelpers'
import type { CustomSet, OptimisticSendIds } from './store'
import type { Message } from './types'

/** The optimistic-paint actions of the chat store: a send's placeholders and the queue hold. */
export interface OptimisticSendActions {
  /**
   * Paint the send instantly: append your message plus (when no run is live yet)
   * an assistant skeleton row, both marked `optimistic`. The server echo replaces
   * them in place (see applyStreamEvent `message.created`), so Enter→visible is a
   * frame instead of a WebSocket round-trip plus the backend's persist chain.
   *
   * A busy session queues the line, so it is held out of the transcript from the start. `hold`
   * asks for the same hold when the client only BELIEVES the session idle: the server may still
   * queue the line, and a row that appeared and vanished again was a flash.
   */
  _appendOptimisticSend: (
    sessionId: string,
    text: string,
    bindings?: MessageBinding[],
    /** Machine-composed (hidden) send — the painted user row carries isInternal. */
    internal?: boolean,
    hold?: boolean,
  ) => OptimisticSendIds
  /** The backend started a turn for a line held out of the transcript: show it. */
  _releaseQueueHold: (sessionId: string, userId: string) => void
  /** Roll one send's placeholders back on failure. Omit ids only for an edit-resend resync
   *  that intentionally discards every unclaimed placeholder before reloading. */
  _dropOptimistic: (sessionId: string, ids?: Partial<OptimisticSendIds>) => void
  /** Stop returned these queued lines to the composer: they leave the session's queue. */
  _discardReturnedQueue: (sessionId: string, clientMessageIds: readonly string[]) => void
}

export function createOptimisticSendActions({
  customSet,
}: {
  customSet: CustomSet
}): OptimisticSendActions {
  return {
    _appendOptimisticSend: (sessionId, text, bindings, internal, hold) => {
      const pair = makeOptimisticPair(text, bindings, internal)
      customSet((state) =>
        patchSessionById(state, sessionId, (session) => {
          const busy = session.isRunning || (session.queuedMessages?.length ?? 0) > 0
          const held = busy || hold === true
          // A busy session queues this line, so it is held out of the transcript from the start.
          const user: Message = held && !internal ? { ...pair.user, awaitsQueue: true } : pair.user
          // A live run already owns an assistant row (and will queue this
          // message), so only your own line is painted — a second skeleton
          // would read as a second reply in flight.
          const assistant: Message | null = busy ? null : pair.assistant
          return {
            ...session,
            messages: assistant
              ? [...session.messages, user, assistant]
              : [...session.messages, user],
            // Drives the transcript's streaming visuals onto the skeleton row.
            streamingMessageId: assistant ? assistant.id : session.streamingMessageId,
          }
        }),
      )
      return { userId: pair.user.id, assistantId: pair.assistant.id }
    },

    _releaseQueueHold: (sessionId, userId) => {
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          session.messages.some((m) => m.id === userId && m.awaitsQueue)
            ? {
                ...session,
                messages: session.messages.map((m) =>
                  m.id === userId ? { ...m, awaitsQueue: undefined } : m,
                ),
              }
            : session,
        ),
      )
    },

    _dropOptimistic: (sessionId, ids) => {
      const ownedIds = ids
        ? new Set(
            [ids.userId, ids.assistantId].filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          )
        : null
      const shouldDrop = (message: Message) =>
        Boolean(message.optimistic) && (!ownedIds || ownedIds.has(message.id))
      customSet((state) =>
        patchSessionById(state, sessionId, (session) =>
          session.messages.some(shouldDrop)
            ? {
                ...session,
                messages: session.messages.filter((message) => !shouldDrop(message)),
                streamingMessageId:
                  session.streamingMessageId &&
                  (!ownedIds
                    ? session.streamingMessageId.startsWith('optimistic-')
                    : ownedIds.has(session.streamingMessageId))
                    ? null
                    : session.streamingMessageId,
              }
            : session,
        ),
      )
    },

    _discardReturnedQueue: (sessionId, clientMessageIds) => {
      const gone = new Set(clientMessageIds)
      if (gone.size === 0) return
      customSet((state) =>
        patchSessionById(state, sessionId, (session) => ({
          ...session,
          queuedMessages: (session.queuedMessages ?? []).filter(
            (item) => !item.clientMessageId || !gone.has(item.clientMessageId),
          ),
          messages: session.messages.filter(
            (message) => !(message.optimistic && gone.has(message.id)),
          ),
        })),
      )
    },
  }
}
