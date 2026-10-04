import { memo } from 'react'
import { isReasoningItem } from '@localixai/agent/agents/items'
import { isItemStreaming, isToolBacked } from './tool-parts/itemHelpers'
import type { Message } from '../model/types'
import { MessageReasoning } from './MessageReasoning'
import { MessageSkeleton } from './MessageSkeleton'
import { useSpinnerVerb } from '../model/useSpinnerVerb'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { MessageAttachments } from './MessageAttachments'
import { MessageContextEvidence } from './MessageContextEvidence'
import { ToolTimingProvider } from './tool-parts/toolTimingContext'
import { useMessageThreadCount } from '../model/useMessageThreadCount'
import { messageStreamStatusLabel, shouldRenderAssistantSkeleton } from '../model/messageActivity'
import { MessageBody } from './MessageBody'
import { MessageContextMenu, useMessageReactionSurface } from './MessageContextMenu'
import { MessageContextActions } from './MessageContextActions'
import { MessageContinuationSegment } from './MessageContinuationSegment'
import { WakeContinuationLine } from './WakeContinuationLine'
import type { WakeSource } from '@/shared/api/contracts'
import { MessagePinnedMark } from './MessagePinnedMark'
import { useMessagePin } from '../model/useMessagePin'
import { MessageFooter } from './MessageFooter'
import { AUTHOR_BODY_INDENT, MessageAuthorLine } from './MessageAuthorLine'
import { useAgentIdentity } from '@/shared/contrib/useAgentIdentity'
import { messageClock } from '../model/messageTime'
import type { MessagePosition } from '../model/messageGroups'
import { DayDivider } from './DayDivider'
import { useConversationMentionHandles } from '../model/useConversationMentionHandles'
import { messageHasVisibleBody, messageIsEmpty } from './messageRenderable'
import { useMessageContextActions } from './useMessageContextActions'
import { useRunEventFocus } from './useRunEventFocus'
import { messageCardPropsEqual } from './messageCardPropsEqual'

interface MessageCardProps {
  message: Message
  /** UI-only continuation; persisted ids and tool ownership stay on each segment. */
  segments?: readonly Message[]
  segmentSessionId?: string | null
  /** What woke each segment after the first — drawn as a system line between segments. */
  segmentWakeSources?: readonly (WakeSource | undefined)[]
  triggerLabel?: string
  /** What woke this row, when it continues a run another row started. */
  triggerSource?: WakeSource
  isStreaming?: boolean
  /** Whether this is the last visible message (gates regenerate). */
  isLast?: boolean
  /** Session-level run flag — belt-and-braces only: an EMPTY last assistant row
   *  while the session is generating still shows a skeleton (never a void),
   *  whatever event ordering left it without a stream target. */
  isGenerating?: boolean
  /** Stable parent callbacks — id-based so MessageCard can be memoized. */
  onRegenerate?: () => void
  onRollback?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onSwitchBranch?: (messageId: string, index: number) => void
  /** Open the side-conversation thread anchored to this (assistant) message. */
  onOpenThread?: (messageId: string) => void
  /** Agnostic activity-phase label (e.g. "Generating title") for the loading skeleton. */
  phaseLabel?: string
  /**
   * Where this card sits in its run of same-speaker messages, and whether it opens a day.
   *
   * Absent means "a card on its own" — which is the right answer for the inspector's replay
   * of one message, and keeps every consumer that has no list around it rendering in full.
   */
  position?: MessagePosition
}

function MessageCardImpl({
  message,
  segments,
  segmentSessionId,
  segmentWakeSources,
  triggerLabel,
  triggerSource,
  isStreaming,
  isLast,
  isGenerating,
  onRegenerate,
  onRollback,
  onEdit,
  onSwitchBranch,
  onOpenThread,
  phaseLabel,
  position,
}: MessageCardProps) {
  const isUser = message.role === 'user'
  const messageId = message.id
  // In-conversation search: ring this card while it's the active match. Subscribes
  // to its OWN match status, so only the leaving + arriving cards re-render.
  const isSearchMatch = useMessageSearchStore((s) => !segments && s.activeId === message.id)
  // The session of the transcript this card is drawn in — never the chat on screen, which a
  // card in a background pane or a replay of another chat does not belong to.
  const replaySessionId = useWorkItemSessionId()
  const mentionHandles = useConversationMentionHandles(replaySessionId)
  const workItemVisible = useWorkItemVisible()
  const isEventRunTarget = useRunEventFocus(replaySessionId, messageId, workItemVisible) !== null
  // Who said it, from the message's stored author — never from the session's party, which
  // says who is here NOW and would relabel an old reply after a hand-off.
  const firstMessage = segments?.[0] ?? message
  const author = useAgentIdentity(firstMessage.from, firstMessage.authorSnapshot)
  // Once per RUN, not once per card. Consecutive replies by one agent are one utterance
  // broken across rows; naming the speaker on each of them is the noise grouping removes.
  const showAuthor = position?.isFirstInGroup ?? true
  const headed = showAuthor ? author : null
  const clock = messageClock(firstMessage.createdAt)
  // Size of the side-conversation thread anchored to this message (if one exists),
  // so the action bar can show a count. 0 = no thread yet → just the open-thread icon.
  const threadCount = useMessageThreadCount(messageId)
  const { contextActions, linkTargets, switchBranch } = useMessageContextActions({
    message,
    segments,
    isUser,
    sessionId: replaySessionId,
    onRollback,
    onEdit,
    onOpenThread,
    onSwitchBranch,
  })
  const isEmpty = messageIsEmpty(message, segments)
  const isAssistantStreaming = Boolean(isStreaming && !isUser)
  // "Loading" = streaming with nothing RENDERABLE yet (see `messageRenderable.ts`).
  const showAssistantSkeleton = shouldRenderAssistantSkeleton({
    isUser,
    isStreaming: isAssistantStreaming,
    isLast: Boolean(isLast),
    isGenerating: Boolean(isGenerating),
    hasVisibleBody: messageHasVisibleBody(message, segments),
  })
  const activeItem = message.items?.find((it) => isToolBacked(it) && isItemStreaming(it))
  const dynamicVerb = useSpinnerVerb(isAssistantStreaming, activeItem)
  const displayVerb = dynamicVerb
    ? dynamicVerb.endsWith('…') || dynamicVerb.endsWith('...')
      ? dynamicVerb
      : `${dynamicVerb}…`
    : 'Working…'
  const streamStatusLabel = messageStreamStatusLabel({
    isStreaming: isAssistantStreaming,
    phaseLabel,
    fallbackLabel: displayVerb,
  })
  const hasThinkingBlocks = (message.items ?? []).some(isReasoningItem)
  const endsRun = position?.isLastInGroup ?? true
  /**
   * ONE footer slot, shared by the streaming and the settled branch.
   *
   * The two used to be two class lists that happened to agree; the rule they were agreeing
   * on is that a row must not change height when its run finishes. One expression makes
   * that structural instead of a coincidence two edits apart — and it is what lets the
   * reserve be conditional at all, since both branches now answer the same condition.
   *
   * A control's height is reserved only where a run ENDS. Under every card in a run it is
   * 36px of nothing, repeated; at the end of one it is the slot the actions live in.
   */
  const footerClass = [
    'lx-message-footer mt-1.5 flex w-full min-w-0 items-center',
    // Pulled out by an icon button's optical inset so the first GLYPH lands on the card's
    // content edge, under the text and the name — not the button's invisible box.
    // One side only: this row is `w-full`, and pulling both would make it wider than the
    // column it sits in. The side is the one the row starts from, which the user's reversed
    // row mirrors.
    isUser
      ? 'mr-[calc(var(--icon-button-optical-inset)*-1)]'
      : 'ml-[calc(var(--icon-button-optical-inset)*-1)]',
    endsRun ? 'min-h-[var(--chrome-control-lg)]' : '',
  ].join(' ')
  const align = isUser ? ('end' as const) : ('start' as const)
  // ABOVE the early returns below: React counts hooks, so one called after a return runs on
  // some renders and not others and tears the route down when the count changes.
  const reactionSurface = useMessageReactionSurface({
    sessionId: replaySessionId ?? null,
    messageId,
    reactions: message.reactions,
    align,
    disabled: isStreaming,
  })
  const pinned = message.pinned === true
  const togglePin = useMessagePin(replaySessionId ?? null, messageId, pinned)

  if (showAssistantSkeleton) {
    // A live backend phase (titling, a terminal wait) wins over the generic verb.
    return (
      <MessageSkeleton
        label={phaseLabel ?? displayVerb}
        author={headed}
        triggerLabel={triggerLabel}
      />
    )
  }
  if (isEmpty) {
    return null
  }

  const renderBody = () => (
    <MessageBody
      message={message}
      isUser={isUser}
      isStreaming={isStreaming}
      isLast={isLast}
      mentionHandles={mentionHandles}
    />
  )

  const body = segments ? (
    <>
      {segments.map((part, index) => (
        <MessageContinuationSegment
          key={part.id}
          message={part}
          sessionId={segmentSessionId}
          addressable={index > 0}
          wakeSource={index === 0 ? undefined : segmentWakeSources?.[index]}
          isLast={index === segments.length - 1 && isLast === true}
          isStreaming={index === segments.length - 1 && isStreaming}
          mentionHandles={mentionHandles}
        />
      ))}
      <MessageFooter
        message={message}
        messageId={messageId}
        isUser={false}
        isLast={isLast}
        clock={clock}
        footerClass={footerClass}
        streamStatusLabel={streamStatusLabel}
        replaySessionId={replaySessionId ?? null}
        threadCount={threadCount}
        contextActions={contextActions}
        sourceItems={segments.flatMap((part) => part.items ?? [])}
        sourceTargets={segments.map((part) => ({ messageId: part.id, items: part.items }))}
        linkTargets={linkTargets}
        onRegenerate={onRegenerate}
        onSwitchBranch={switchBranch}
      />
    </>
  ) : (
    <>
      {!isUser && !hasThinkingBlocks && message.reasoning && (
        <MessageReasoning text={message.reasoning} isStreaming={isStreaming && !message.content} />
      )}

      <ToolTimingProvider tools={message.timing?.tools}>{renderBody()}</ToolTimingProvider>

      {/* User uploads AND plugin-added deliverables (onAssistantMessage hooks)
          render with the same chips/thumbnails; alignment follows the article. */}
      {message.bindings?.length ? (
        <MessageAttachments bindings={message.bindings} align={align} />
      ) : null}

      {/* The contexts the message carried, as one quiet summary that opens the inspector (the
          resolved contribution bodies are model-only and never rendered inline). */}
      {isUser && (
        <MessageContextEvidence bindings={message.bindings} sessionId={replaySessionId ?? null} />
      )}

      {reactionSurface.chips}

      {pinned ? <MessagePinnedMark align={align} /> : null}

      <MessageFooter
        message={message}
        messageId={messageId}
        isUser={isUser}
        isLast={isLast}
        clock={clock}
        footerClass={footerClass}
        streamStatusLabel={streamStatusLabel}
        replaySessionId={replaySessionId ?? null}
        threadCount={threadCount}
        contextActions={contextActions}
        onRegenerate={onRegenerate}
        onSwitchBranch={switchBranch}
      />
    </>
  )

  return (
    // Right-click reaches the whole card — Telegram puts its strip on the same gesture.
    <MessageContextMenu
      {...reactionSurface.menuProps}
      actions={
        <MessageContextActions
          {...contextActions}
          {...(replaySessionId && !message.isInternal
            ? { pin: { pinned, onToggle: togglePin } }
            : {})}
        />
      }
    >
      <article
        className={[
          'group relative flex w-full flex-col transition-shadow',
          isUser ? 'items-end' : 'items-start',
          // The rest of the run's spacing is the list's row gap. This is the extra air that
          // separates one voice from the next — four times the gap inside a run, which is the
          // whole visual difference between "still speaking" and "someone else now".
          endsRun ? 'pb-[1.125rem]' : '',
          isSearchMatch ? 'lx-search-match rounded-2xl' : '',
          isEventRunTarget ? 'lx-target-reveal rounded-2xl' : '',
        ].join(' ')}
      >
        {position?.dayStart && <DayDivider day={position.dayStart} />}
        {author ? (
          <>
            {headed && (
              <MessageAuthorLine author={headed} clock={clock} triggerLabel={triggerLabel} />
            )}
            {!segments && !headed && message.continuedFromMessageId && triggerSource && (
              <WakeContinuationLine source={triggerSource} />
            )}
            {/* One gap between stacked parts (a chain, a disclosure, a bubble) instead of each
              part carrying padding of its own — which is what put three left edges and two
              vertical rhythms on one card. */}
            <div className={`flex w-full min-w-0 flex-col items-start gap-2 ${AUTHOR_BODY_INDENT}`}>
              {body}
            </div>
          </>
        ) : (
          body
        )}
      </article>
    </MessageContextMenu>
  )
}

export const MessageCard = memo(MessageCardImpl, messageCardPropsEqual)
