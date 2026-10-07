import { isToolBackedItem, type AgentItem, type ToolBackedItem } from '@localixai/agent/agents'
import type { RunEnv } from './types'

/** Late background updates belong to their sealed row, never the response now being written. */
export function createOwnedItemUpdater(env: RunEnv, userId: string, sessionId: string) {
  const lanes = new Map<string, Promise<void>>()
  return (messageId: string, toolCallId: string, update: (item: ToolBackedItem) => AgentItem) => {
    const operation = (lanes.get(messageId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const message = await env.repo.getMessage(userId, sessionId, messageId)
        if (!message) return
        let found = false
        const items = message.payload.items?.map((item) => {
          if (!isToolBackedItem(item) || item.toolCallId !== toolCallId) return item
          found = true
          return update(item)
        })
        if (found)
          await env.persistAndPublish(
            userId,
            sessionId,
            messageId,
            { ...message.payload, items },
            message.createdAt,
          )
      })
    lanes.set(messageId, operation)
    void operation
      .finally(() => {
        if (lanes.get(messageId) === operation) lanes.delete(messageId)
      })
      .catch(() => {})
    return operation
  }
}
