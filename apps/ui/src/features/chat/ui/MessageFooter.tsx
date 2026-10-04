/**
 * THE LINE UNDER A MESSAGE: its clock, its command mark, and its actions.
 *
 * Its own component because it is the one part of a card that has to hold a SLOT open. While a
 * reply is live the slot carries the stream status; when the run settles it carries the actions.
 * Both occupy the same row, which is what keeps the transcript from jumping the moment a run
 * finishes — a rule that is easy to break while editing the card around it, and invisible when
 * broken until someone watches a long answer land.
 */
import type { ReactNode } from 'react'

import { CommandMark } from './CommandMark'
import { MessageActions } from './MessageActions'
import { MessageActionsRow } from './MessageActionsRow'
import { WorkingIndicator } from './WorkingIndicator'
import type { Message } from '@/shared/api/contracts'
import type { MessageContextActionsProps } from './MessageContextActions'
import type { AgentItem } from '@localixai/agent/agents'

export function shouldShowCommandOrigin(
  message: Pick<Message, 'commandOrigin' | 'content'>,
): boolean {
  return Boolean(message.commandOrigin && !message.content?.trimStart().startsWith('/'))
}

export function MessageFooter({
  message,
  messageId,
  isUser,
  isLast,
  clock,
  footerClass,
  streamStatusLabel,
  replaySessionId,
  threadCount,
  contextActions,
  sourceItems,
  sourceTargets,
  linkTargets,
  onRegenerate,
  onSwitchBranch,
}: {
  message: Message
  messageId: string
  isUser: boolean
  isLast?: boolean
  clock?: string | null
  footerClass: string
  streamStatusLabel?: string | null
  replaySessionId: string | null
  threadCount?: number
  contextActions: MessageContextActionsProps
  sourceItems?: readonly AgentItem[]
  sourceTargets?: readonly { messageId: string; items: readonly AgentItem[] | undefined }[]
  linkTargets?: readonly { id: string; onLink: () => void }[]
  onRegenerate?: () => void
  onSwitchBranch?: (index: number) => void
}): ReactNode {
  return (
    <>
      {isUser && message.commandOrigin && shouldShowCommandOrigin(message) ? (
        <div className="mt-0.5 flex items-center gap-1 px-1 py-0.5 text-2xs text-text-faint">
          <CommandMark label={message.commandOrigin.command} />
          {message.commandOrigin.label && (
            <span className="text-text-faint">· {message.commandOrigin.label}</span>
          )}
        </div>
      ) : null}

      {/* While this reply is live, its footer becomes the one persistent stream-status
          line. It occupies the exact slot used by settled actions/metadata, so the row
          never jumps when the run finishes. */}
      {streamStatusLabel ? (
        <div className={`${footerClass} overflow-hidden`}>
          <WorkingIndicator label={streamStatusLabel} className="min-w-0" />
        </div>
      ) : (
        /* One stable, quiet footer: only message actions live here. Provider, timing, cost and
           source detail belong to Activity, where they can be inspected without turning every
           answer into a status bar. */
        <div
          className={[
            footerClass,
            isUser ? 'flex-row-reverse justify-start text-right' : 'justify-start text-left',
          ].join(' ')}
        >
          {/* The user's own line has no author row above it — this is where its clock goes.
              First in the DOM so the reversed row puts it on the far right, where a chat
              client puts the time of what you just sent. */}
          {isUser && clock && (
            <span className="shrink-0 px-1 text-2xs tabular-nums text-text-faint">{clock}</span>
          )}
          <MessageActionsRow>
            <MessageActions
              role={message.role as 'user' | 'assistant'}
              branches={message.branchCount}
              branchIndex={message.branchIndex}
              onRegenerate={isUser ? undefined : isLast ? onRegenerate : undefined}
              {...contextActions}
              linkTargets={linkTargets}
              onSwitchBranch={onSwitchBranch}
              threadCount={threadCount}
              sources={
                isUser
                  ? undefined
                  : {
                      items: sourceItems ?? message.items,
                      messageId,
                      sourceTargets,
                      ...(replaySessionId ? { sessionId: replaySessionId } : {}),
                    }
              }
            />
          </MessageActionsRow>
        </div>
      )}
    </>
  )
}
