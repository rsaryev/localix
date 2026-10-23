/**
 * THE VERBS ONE MESSAGE OFFERS, bound to that message, in one bag.
 *
 * The hover row (`MessageActions`) and the right-click menu (`MessageContextActions`) both take
 * this bag. Built twice, they could come to differ about which verbs a given message supports —
 * the menu offering an edit the row does not, or the other way round — and a reader cannot tell
 * which of the two is lying. Built once, a verb that does not apply is `undefined` in both.
 */
import { useCallback } from 'react'
import { copyableMessageText } from '@localixai/agent/agents'
import { messageBindingDraft } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { composerBus } from '@/shared/lib/composerBus'
import { inspector } from '@/shared/lib/inspectorBus'
import type { Message } from '../model/types'
import type { MessageContextActionsProps } from './MessageContextActions'
import { isToolBacked } from './tool-parts/itemHelpers'

/**
 * Link one message into the composer: mint a `@message:<sessionId>/<messageId>` context-ref and
 * route it into this session's composer via the bus → PromptInput's binding sink → pinned
 * context binding.
 */
function linkMessageIntoComposer(sessionId: string, message: Pick<Message, 'id' | 'content'>) {
  composerBus.insert({
    bindings: [messageBindingDraft(sessionId, message.id, message.content ?? '')],
    sessionId,
  })
}

export function useMessageContextActions({
  message,
  segments,
  isUser,
  sessionId,
  onRollback,
  onEdit,
  onOpenThread,
  onSwitchBranch,
}: {
  message: Message
  segments?: readonly Message[]
  isUser: boolean
  sessionId: string | null | undefined
  onRollback?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onOpenThread?: (messageId: string) => void
  onSwitchBranch?: (messageId: string, index: number) => void
}): {
  contextActions: MessageContextActionsProps
  /** One link per segment of a continued answer; absent for a single message. */
  linkTargets?: readonly { id: string; onLink: () => void }[]
  switchBranch?: (index: number) => void
} {
  const messageId = message.id
  const toolSegment = (segments ?? [message]).find((part) => (part.items ?? []).some(isToolBacked))
  const hasTools = Boolean(toolSegment)
  const handleOpenReplay = useCallback(() => {
    if (sessionId) inspector.openMessageReplay(sessionId, toolSegment?.id ?? messageId)
  }, [sessionId, toolSegment?.id, messageId])
  const handleRollback = useCallback(() => onRollback?.(messageId), [onRollback, messageId])
  const handleOpenThread = useCallback(() => onOpenThread?.(messageId), [onOpenThread, messageId])
  const handleSwitchBranch = useCallback(
    (index: number) => onSwitchBranch?.(messageId, index),
    [onSwitchBranch, messageId],
  )
  // Triggered by the Link button in MessageActions.
  const handleLinkMessage = useCallback(() => {
    if (!sessionId) return
    linkMessageIntoComposer(sessionId, { id: messageId, content: message.content })
  }, [sessionId, messageId, message.content])
  // Edit now loads the message text into the MAIN composer rather
  // than an inline transcript textarea — the actual fork-on-edit persist is owned
  // by the composer. This just hands the message id + current text upward.
  const handleBeginEdit = useCallback(
    () => onEdit?.(messageId, message.content ?? ''),
    [onEdit, messageId, message.content],
  )
  const copyText = segments
    ? segments
        .map((part) => copyableMessageText(part))
        .filter(Boolean)
        .join('\n\n')
    : copyableMessageText(message)

  return {
    contextActions: {
      text: copyText ?? undefined,
      onLink: sessionId ? handleLinkMessage : undefined,
      linkDraft: sessionId
        ? () => messageBindingDraft(sessionId, messageId, message.content ?? '')
        : undefined,
      onOpenReplay: !isUser && hasTools ? handleOpenReplay : undefined,
      onOpenThread: !isUser && onOpenThread ? handleOpenThread : undefined,
      onEdit: isUser && onEdit ? handleBeginEdit : undefined,
      onRollback: isUser && onRollback ? handleRollback : undefined,
    },
    linkTargets:
      segments && sessionId
        ? segments.map((part) => ({
            id: part.id,
            onLink: () => linkMessageIntoComposer(sessionId, part),
          }))
        : undefined,
    switchBranch: onSwitchBranch ? handleSwitchBranch : undefined,
  }
}
