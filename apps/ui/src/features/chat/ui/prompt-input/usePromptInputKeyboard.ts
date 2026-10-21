import { useCallback } from 'react'
import type { SessionQueueItem } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { useChatStore } from '@/features/chat/model/store'
import { composerBus } from '@/shared/lib/composerBus'
import { toast } from '@/shared/lib/notify'
import { CMD, useKeybindingMatcher } from '@/shared/lib/keybindings'
import { promptAfterMentionBackspace } from './mentionBackspace'
import { returnNextQueuedMessage, type QueueReturnOutcome } from './queue-actions'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

type ComposerKeyHandler = (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean

interface PromptInputKeyboardOptions {
  activeSessionId: string | null
  prompt: string
  setPrompt: (value: string) => void
  isEditing: boolean
  onCancelEdit?: () => void
  isGenerating: boolean
  readOnly: boolean
  onStop: () => void
  serverQueue?: SessionQueueItem[]
  onInlineCompletionKeyDown: ComposerKeyHandler
  onOpenResourceKeyDown: ComposerKeyHandler
  onHistoryKeyDown: ComposerKeyHandler
  onAtRefKeyDown: ComposerKeyHandler
  onComposerCommandKeyDown: ComposerKeyHandler
}

// A returned message lands in the composer under the person's cursor, so it needs no row: the
// Event Center is durable, and a journal of "returned it" entries would bury the ones that matter.
// Only the outcomes where Escape visibly did nothing are said.
function reportQueueReturn(outcome: QueueReturnOutcome): void {
  if (outcome === 'returned') return
  if (outcome === 'not_returnable')
    toast.info('Nothing in the queue can return to the composer', {
      description: 'Only wakes are queued, and a wake carries no text of yours to edit.',
    })
  else if (outcome === 'leased')
    toast.info('This queued message is already being sent', {
      description: 'It was not returned to the composer.',
    })
  else if (outcome === 'batched')
    toast.info('This queued message is sent together with others', {
      description: 'Remove the whole batch from the queue list to edit it.',
    })
  else if (outcome === 'not_found') toast.info('This queued message is no longer available')
  else toast.info('No queued messages to return')
}

/**
 * Owns the composer's keyboard precedence and Escape queue semantics. Keeping
 * this sequence in one hook makes menu dismissal, edit cancellation, queue
 * restoration, and stop-generation mutually exclusive and testable as a unit.
 */
export function usePromptInputKeyboard({
  activeSessionId,
  prompt,
  setPrompt,
  isEditing,
  onCancelEdit,
  isGenerating,
  readOnly,
  onStop,
  serverQueue,
  onInlineCompletionKeyDown,
  onOpenResourceKeyDown,
  onHistoryKeyDown,
  onAtRefKeyDown,
  onComposerCommandKeyDown,
}: PromptInputKeyboardOptions): ComposerKeyHandler {
  const matchesKey = useKeybindingMatcher()

  const returnQueuedOnEscape = useCallback(() => {
    if (!activeSessionId) return
    void returnNextQueuedMessage({
      sessionId: activeSessionId,
      serverQueue,
      removeServer: (sessionId, itemId) => backendClient.removeQueuedMessage(sessionId, itemId),
      restore: ({ content, bindings }) =>
        composerBus.insert({
          sessionId: activeSessionId,
          text: content,
          bindings,
          buffer: true,
        }),
      onRemoved: (item) => {
        if (item.clientMessageId)
          useChatStore.getState()._dropOptimistic(activeSessionId, { userId: item.clientMessageId })
      },
    })
      .then(reportQueueReturn)
      .catch((err: unknown) =>
        toast.error('Could not return the queued message to the composer', {
          description: errorMessage(err, '') || undefined,
        }),
      )
  }, [activeSessionId, serverQueue])

  return useCallback(
    (event) => {
      const nextPrompt = promptAfterMentionBackspace(event, prompt)
      if (nextPrompt !== null) {
        event.preventDefault()
        setPrompt(nextPrompt)
        return true
      }

      const completionHandlers = [
        onInlineCompletionKeyDown,
        onOpenResourceKeyDown,
        onHistoryKeyDown,
        onAtRefKeyDown,
        onComposerCommandKeyDown,
      ]
      for (const handleKeyDown of completionHandlers) {
        if (handleKeyDown(event)) return true
      }

      if (isEditing && event.key === 'Escape' && onCancelEdit) {
        event.preventDefault()
        onCancelEdit()
        return true
      }
      if (event.key === 'Escape' && !readOnly && (serverQueue?.length ?? 0) > 0) {
        event.preventDefault()
        returnQueuedOnEscape()
        return true
      }
      if (event.key === 'Escape' && !isGenerating && !readOnly && activeSessionId) {
        event.preventDefault()
        reportQueueReturn('empty')
        return true
      }
      if (matchesKey(event, CMD.stopGeneration) && isGenerating && !readOnly) {
        event.preventDefault()
        onStop()
        return true
      }
      return false
    },
    [
      prompt,
      setPrompt,
      onInlineCompletionKeyDown,
      onOpenResourceKeyDown,
      onHistoryKeyDown,
      onAtRefKeyDown,
      onComposerCommandKeyDown,
      isEditing,
      onCancelEdit,
      readOnly,
      serverQueue,
      returnQueuedOnEscape,
      isGenerating,
      activeSessionId,
      matchesKey,
      onStop,
    ],
  )
}
