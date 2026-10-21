import { useMemo } from 'react'
import { useChatStore, type ChatStore } from './store'

const MESSAGE_THREAD_PREFIX = 'message-thread:'
const threadCountIndexes = new WeakMap<ChatStore['allSessions'], ReadonlyMap<string, number>>()

function threadCountIndex(sessions: ChatStore['allSessions']): ReadonlyMap<string, number> {
  const cached = threadCountIndexes.get(sessions)
  if (cached) return cached
  const index = new Map<string, number>()
  for (const session of sessions) {
    const source = session.sourceToolCallId
    if (!source?.startsWith(MESSAGE_THREAD_PREFIX)) continue
    index.set(source.slice(MESSAGE_THREAD_PREFIX.length), session.messageCount ?? 0)
  }
  threadCountIndexes.set(sessions, index)
  return index
}

/** Resolve a side-thread badge through the roster-scoped shared index. */
export function messageThreadCount(sessions: ChatStore['allSessions'], messageId: string): number {
  return threadCountIndex(sessions).get(messageId) ?? 0
}

export function useMessageThreadCount(messageId: string): number {
  // Zustand invokes every mounted selector for each stream commit. One selector per
  // card used to scan the full roster; this stable selector shares one roster index.
  const selector = useMemo(
    () => (state: ChatStore) => messageThreadCount(state.allSessions, messageId),
    [messageId],
  )
  return useChatStore(selector)
}
