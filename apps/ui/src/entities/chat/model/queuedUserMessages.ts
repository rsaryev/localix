import type { SessionQueueItem } from '@/shared/api/contracts'

/**
 * The transcript without the person's messages that are still waiting in the queue.
 *
 * A message sent while a run is active waits in the queue, and it also showed in the transcript
 * at once, above an answer it had not been part of: the conversation read as if it had been said
 * already. It now shows in the queue only (the dock beside send) and enters the transcript when
 * its turn starts and the queue lets it go. The queued item names the row it came from by
 * `clientMessageId`, the id of that local row, so nothing is matched by text.
 */
export function withoutQueuedUserMessages<T extends { id: string }>(
  messages: T[],
  queue: readonly Pick<SessionQueueItem, 'kind' | 'clientMessageId'>[] | undefined,
): T[] {
  const waiting = new Set(
    (queue ?? []).flatMap((item) =>
      item.kind === 'user' && item.clientMessageId ? [item.clientMessageId] : [],
    ),
  )
  return waiting.size ? messages.filter((message) => !waiting.has(message.id)) : messages
}
