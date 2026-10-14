import {
  accumulateUsage,
  createUsageAccumulator,
  finishUsageAccumulator,
  hasRecordedUsage,
  type ChatCacheDiagnosticsPayload,
  type ChatUsagePayload,
} from '@localixai/agent'
import type { Message } from '@/features/chat/model/types'
import {
  contextAttemptFromMessage,
  contextWindowFromParts,
  type ContextAttemptSnapshot,
  type ContextWindowDiagnostics,
} from '@/features/chat/model/contextUsage'
import { isCommandItem, isFileChangeItem, isMcpCallItem } from '@localixai/agent/agents/items'
import { findLastStreamingToolItem } from '@/features/chat/ui/tool-parts/itemHelpers'

export interface ChatSurfaceSnapshot {
  userText: string
  activeToolName: string | null
  /** Usage from the newest assistant turn that completed a provider request. */
  lastSuccessfulUsage: ChatUsagePayload | undefined
  /** Outcome/provenance for the newest assistant attempt, even when it has no usage. */
  latestContextAttempt: ContextAttemptSnapshot | undefined
  latestContextWindow: ContextWindowDiagnostics | undefined
  sessionUsage: ChatUsagePayload | undefined
  latestCacheDiagnostics: ChatCacheDiagnosticsPayload | undefined
}

export interface ChatSurfaceSnapshotMetrics {
  messagesVisited: number
}

function activeToolNameFor(message: Message | undefined): string | null {
  const streamingItem = findLastStreamingToolItem(message?.items ?? [])
  return streamingItem
    ? isCommandItem(streamingItem)
      ? 'bash'
      : isFileChangeItem(streamingItem)
        ? 'file_change'
        : isMcpCallItem(streamingItem)
          ? streamingItem.tool
          : streamingItem.name
    : null
}

/**
 * Derive every transcript-tail value consumed by ChatSurface in one forward
 * pass. The returned selector is identity-memoized because many surface state
 * changes (composer input, scroll state, catalogs) leave the message array
 * untouched and must not rescan a long transcript.
 */
export function createChatSurfaceSnapshotSelector(
  onDerive?: (metrics: ChatSurfaceSnapshotMetrics) => void,
): (messages: readonly Message[]) => ChatSurfaceSnapshot {
  let previousMessages: readonly Message[] | undefined
  let previousSnapshot: ChatSurfaceSnapshot | undefined

  return (messages) => {
    if (messages === previousMessages && previousSnapshot) return previousSnapshot

    // The hot streaming shape replaces only the last assistant object while its
    // aggregate metadata remains unchanged. Re-derive the live tool tail in O(1)
    // and retain every transcript-wide aggregate instead of scanning 100k rows on
    // every token delta.
    if (
      previousMessages &&
      previousSnapshot &&
      messages.length === previousMessages.length &&
      messages.length > 0 &&
      (messages.length === 1 ||
        messages[messages.length - 2] === previousMessages[previousMessages.length - 2])
    ) {
      const previousTail = previousMessages[previousMessages.length - 1]!
      const nextTail = messages[messages.length - 1]!
      if (
        previousTail.id === nextTail.id &&
        previousTail.role === 'assistant' &&
        nextTail.role === 'assistant' &&
        previousTail.usage === nextTail.usage &&
        previousTail.dataParts === nextTail.dataParts &&
        previousTail.cacheDiagnostics === nextTail.cacheDiagnostics
      ) {
        previousMessages = messages
        previousSnapshot = {
          ...previousSnapshot,
          activeToolName: activeToolNameFor(nextTail),
        }
        onDerive?.({ messagesVisited: 1 })
        return previousSnapshot
      }
    }

    let userText = ''
    let lastSuccessfulUsage: ChatUsagePayload | undefined
    let latestContextAttempt: ContextAttemptSnapshot | undefined
    let latestContextWindow: ContextWindowDiagnostics | undefined
    let latestCacheDiagnostics: ChatCacheDiagnosticsPayload | undefined
    const usageAccumulator = createUsageAccumulator()

    for (const message of messages) {
      if (message.role === 'user') userText = message.content ?? ''
      if (message.role !== 'assistant') continue

      latestContextAttempt = contextAttemptFromMessage(message)
      if (message.cacheDiagnostics) latestCacheDiagnostics = message.cacheDiagnostics
      latestContextWindow = contextWindowFromParts(message.dataParts) ?? latestContextWindow

      const usage = message.usage
      // Use the shared accounting predicate so cost-only or adapter-partial payloads
      // do not disappear from one surface while remaining visible in another.
      if (!hasRecordedUsage(usage)) continue
      lastSuccessfulUsage = usage
      accumulateUsage(usageAccumulator, usage)
    }

    const activeToolName = activeToolNameFor(messages[messages.length - 1])

    const sessionUsage = finishUsageAccumulator(usageAccumulator)

    previousMessages = messages
    previousSnapshot = {
      userText,
      activeToolName,
      lastSuccessfulUsage,
      latestContextAttempt,
      latestContextWindow,
      sessionUsage,
      latestCacheDiagnostics,
    }
    onDerive?.({ messagesVisited: messages.length })
    return previousSnapshot
  }
}
