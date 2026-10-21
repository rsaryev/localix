/**
 * ONE PERSISTED MESSAGE inside a card that shows a continued answer as one utterance.
 *
 * The card merges the segments for the eye only. Each segment is still its own stored row: a
 * search hit, an Event Center jump, a reaction or a `localix://` link names THAT row's id, and a
 * card that answered for the merged whole would ring the wrong part, or none. So every segment
 * carries its own target, match ring, reveal and reaction surface — hooks, which is why this is
 * a component per segment rather than markup inside the card's `map`. The first segment is the
 * card's own address (the list row registers it), so only the ones after it register here.
 */
import { isReasoningItem } from '@localixai/agent/agents/items'
import { localixResourceUri } from '@localixai/plugin-sdk/navigation'
import { useUiTarget } from '@/shared/hooks/useUiTarget'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import type { Message } from '../model/types'
import { MessageAttachments } from './MessageAttachments'
import { MessageBody } from './MessageBody'
import { useMessageReactionSurface } from './MessageContextMenu'
import { MessagePinnedMark } from './MessagePinnedMark'
import { MessageReasoning } from './MessageReasoning'
import { ToolTimingProvider } from './tool-parts/toolTimingContext'
import { useRunEventFocus } from './useRunEventFocus'
import { WakeContinuationLine } from './WakeContinuationLine'
import type { WakeSource } from '@/shared/api/contracts'

export function MessageContinuationSegment({
  message,
  sessionId,
  addressable,
  wakeSource,
  isLast,
  isStreaming,
  mentionHandles,
}: {
  message: Message
  sessionId?: string | null
  addressable: boolean
  /** What woke this segment, drawn as a system line above it. */
  wakeSource?: WakeSource
  isLast: boolean
  isStreaming?: boolean
  mentionHandles?: readonly string[]
}) {
  const uri =
    addressable && sessionId
      ? localixResourceUri('chat', ['message', sessionId, message.id])
      : undefined
  const targetRef = useUiTarget<HTMLDivElement>(uri)
  const searched = useMessageSearchStore((state) => state.activeId === message.id)
  const reactions = useMessageReactionSurface({
    sessionId: sessionId ?? null,
    messageId: message.id,
    reactions: message.reactions,
    disabled: isStreaming,
  })
  const eventFocus = useRunEventFocus(sessionId, message.id, Boolean(sessionId))
  return (
    <div
      ref={targetRef}
      data-message-id={message.id}
      className={[
        'flex w-full min-w-0 flex-col items-start gap-2 scroll-mt-12',
        searched ? 'lx-search-match rounded-2xl' : '',
        eventFocus ? 'lx-target-reveal rounded-2xl' : '',
      ].join(' ')}
    >
      {wakeSource && <WakeContinuationLine source={wakeSource} />}
      {message.reasoning && !(message.items ?? []).some(isReasoningItem) && (
        <MessageReasoning text={message.reasoning} isStreaming={isStreaming && !message.content} />
      )}
      <ToolTimingProvider tools={message.timing?.tools}>
        <MessageBody
          message={message}
          isUser={false}
          isStreaming={isStreaming}
          isLast={isLast}
          mentionHandles={mentionHandles}
        />
      </ToolTimingProvider>
      {message.bindings?.length ? (
        <MessageAttachments bindings={message.bindings} align="start" />
      ) : null}
      {reactions.chips}
      {message.pinned ? <MessagePinnedMark align="start" /> : null}
    </div>
  )
}
