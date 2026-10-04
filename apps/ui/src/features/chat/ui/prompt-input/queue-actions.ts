import type {
  MessageBinding,
  QueueClearResult,
  QueueRemovalResult,
  SessionQueueItem,
} from '@/shared/api/contracts'
import { queueItemCapabilities } from '@localixai/api/queue-presentation'

export interface RestoredQueueMessage {
  content: string
  bindings?: MessageBinding[]
}

export async function returnServerQueueItem(input: {
  sessionId: string
  itemId: string
  remove: (sessionId: string, itemId: string) => Promise<QueueRemovalResult>
  restore: (message: RestoredQueueMessage) => void
  onRemoved?: () => void
}): Promise<QueueRemovalResult> {
  const result = await input.remove(input.sessionId, input.itemId)
  if (result.removed) {
    input.onRemoved?.()
    input.restore({
      content: result.content,
      ...(result.bindings?.length ? { bindings: result.bindings } : {}),
    })
  }
  return result
}

/** Delete an internal server wake without reinterpreting its trusted payload as
 * operator-authored composer text. The backend remains the cancellation arbiter. */
export async function deleteServerQueueItem(input: {
  sessionId: string
  itemId: string
  remove: (sessionId: string, itemId: string) => Promise<QueueRemovalResult>
}): Promise<QueueRemovalResult> {
  return input.remove(input.sessionId, input.itemId)
}

export type QueueReturnOutcome = 'returned' | 'empty' | 'not_returnable' | 'leased' | 'not_found'

/**
 * Escape-path queue return for the first operator-authored row. Internal wakes
 * are trusted runtime payloads: they may be deleted explicitly, but must never
 * be removed and reinterpreted as user-authored composer text.
 */
export async function returnNextQueuedMessage(input: {
  sessionId: string
  serverQueue?: SessionQueueItem[]
  removeServer: (sessionId: string, itemId: string) => Promise<QueueRemovalResult>
  restore: (message: RestoredQueueMessage) => void
  onRemoved?: (item: SessionQueueItem) => void
}): Promise<QueueReturnOutcome> {
  const queue = input.serverQueue ?? []
  if (queue.length === 0) return 'empty'
  const serverItem = queue.find((item) => queueItemCapabilities(item.kind).canReturnToComposer)
  if (!serverItem) return 'not_returnable'
  const result = await returnServerQueueItem({
    sessionId: input.sessionId,
    itemId: serverItem.id,
    remove: input.removeServer,
    restore: input.restore,
    onRemoved: () => input.onRemoved?.(serverItem),
  })
  return result.removed ? 'returned' : 'reason' in result ? result.reason : 'not_found'
}

export async function clearServerQueue(input: {
  sessionId: string
  clear: (sessionId: string) => Promise<QueueClearResult>
}): Promise<QueueClearResult> {
  return input.clear(input.sessionId)
}
