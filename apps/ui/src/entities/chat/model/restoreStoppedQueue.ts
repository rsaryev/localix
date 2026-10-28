import type { MessageBinding, QueueReturnedMessage } from '@/shared/api/contracts'
import { composerBus } from '@/shared/lib/composerBus'
import type { ChatStore } from './store'

/** Several returned lines are one draft, in the order they were queued: a paragraph each. */
export function joinReturnedMessages(returned: readonly QueueReturnedMessage[]): {
  text: string
  bindings: MessageBinding[]
} {
  return {
    text: returned
      .map((message) => message.content)
      .filter((content) => content.trim().length > 0)
      .join('\n\n'),
    bindings: returned.flatMap((message) => message.bindings ?? []),
  }
}

/**
 * Stop took the person's queued messages back instead of delivering them: put their words and
 * attachments in the composer, and empty the queue the person was looking at, so nothing is lost
 * and nothing is sent unless they send it.
 */
export function restoreStoppedQueue(
  get: () => ChatStore,
  sessionId: string,
  returned: readonly QueueReturnedMessage[],
): void {
  if (returned.length === 0) return
  const { text, bindings } = joinReturnedMessages(returned)
  composerBus.insert({
    sessionId,
    text,
    ...(bindings.length ? { bindings } : {}),
    hold: true,
  })
  get()._discardReturnedQueue(
    sessionId,
    returned.flatMap((message) => (message.clientMessageId ? [message.clientMessageId] : [])),
  )
}
