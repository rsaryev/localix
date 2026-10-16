import { useState, useCallback } from 'react'
import {
  Copy,
  Check,
  RotateCcw,
  CornerUpLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Volume2,
  Square,
  MessagesSquare,
  History,
  Link2,
  MoreHorizontal,
} from 'lucide-react'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import type { AgentItem } from '@localixai/agent/agents'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { MessageSources } from './MessageSources'
import { linkDragProps } from './linkDrag'
import { speechAvailable, useReadAloud } from './useReadAloud'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { COPIED_FEEDBACK_LONG_MS } from '@/shared/lib/timings'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  text?: string
  branches?: number
  branchIndex?: number
  onRegenerate?: () => void
  onRollback?: () => void
  onEdit?: () => void
  onSwitchBranch?: (index: number) => void
  onOpenThread?: () => void
  /** Number of messages in the side-thread anchored to this message. 0 = no thread
   *  yet → render just the open-thread icon (never a "0"). */
  threadCount?: number
  /** Mirror this message's tool outputs in the inspector Snapshot tab. Present
   *  only on assistant messages that actually ran tools. */
  onOpenReplay?: () => void
  /** Link this message into the composer as a pinned `@message:` context-ref. */
  onLink?: () => void
  /** The same link, for DRAGGING the button onto a board, a tab or another composer. */
  linkDraft?: () => MessageContextBindingDraft | null
  linkTargets?: readonly { id: string; onLink: () => void }[]
  /** Evidence used by this answer, rendered as a compact action when non-empty. */
  sources?: {
    items: readonly AgentItem[] | undefined
    messageId: string
    sessionId?: string
    sourceTargets?: readonly { messageId: string; items: readonly AgentItem[] | undefined }[]
  }
}

const actionButtonClass =
  'text-text-faint hover:bg-surface-hover hover:text-foreground disabled:opacity-25'

export function MessageActions({
  role,
  text,
  branches,
  branchIndex,
  onRegenerate,
  onRollback,
  onEdit,
  onSwitchBranch,
  onOpenThread,
  threadCount = 0,
  onOpenReplay,
  onLink,
  linkDraft,
  linkTargets,
  sources,
}: MessageActionsProps) {
  const { copied, copy } = useCopied(COPIED_FEEDBACK_LONG_MS)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { speaking, toggle: handleSpeak } = useReadAloud(text)

  const handleCopy = useCallback(() => {
    if (text) void copy(text)
  }, [text, copy])

  // Branches can appear on user messages too now (editing a past user message
  // forks a sibling), not just assistant regenerations.
  const hasBranches = branches !== undefined && branches > 1
  const idx = branchIndex ?? 0
  const canSpeak = role === 'assistant' && Boolean(text) && speechAvailable()
  const hasMoreActions = canSpeak || Boolean(onOpenReplay || onOpenThread || onRollback)

  return (
    <>
      <div
        data-message-actions
        className={[
          'flex min-w-0 items-center gap-0.5',
          role === 'user' ? 'justify-end' : 'justify-start',
        ].join(' ')}
      >
        {hasBranches && (
          <div className="mr-1 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={actionButtonClass}
              disabled={idx === 0}
              onClick={() => onSwitchBranch?.(idx - 1)}
              title="Previous"
              aria-label="Previous"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="min-w-8 select-none text-center font-variant-numeric-tabular text-xs text-text-faint">
              {idx + 1}/{branches}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className={actionButtonClass}
              disabled={idx === (branches ?? 1) - 1}
              onClick={() => onSwitchBranch?.(idx + 1)}
              title="Next"
              aria-label="Next"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}

        {text && (
          <Button
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            onClick={handleCopy}
            title="Copy"
            aria-label="Copy"
          >
            {copied ? (
              <Check className="size-3.5 text-status-success" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}

        {role === 'user' && onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            onClick={onEdit}
            title="Edit & fork"
            aria-label="Edit & fork"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}

        {linkTargets?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={actionButtonClass}
                title="Link answer segment to chat"
                aria-label="Link answer segment to chat"
              >
                <Link2 className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {linkTargets.map((target, index) => (
                <DropdownMenuItem key={target.id} onSelect={target.onLink}>
                  Segment {index + 1}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          onLink && (
            <Button
              variant="ghost"
              size="icon"
              className={actionButtonClass}
              onClick={onLink}
              {...(linkDraft ? linkDragProps(linkDraft) : {})}
              title="Link message to chat · or drag it onto a board"
              aria-label="Link message to chat"
            >
              <Link2 className="size-3.5" />
            </Button>
          )
        )}

        {role === 'assistant' && onRegenerate && (
          <Button
            variant="ghost"
            size="icon"
            className={actionButtonClass}
            onClick={onRegenerate}
            title="Regenerate"
            aria-label="Regenerate"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}

        {hasMoreActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={actionButtonClass}
                title="More actions"
                aria-label="More actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={role === 'user' ? 'end' : 'start'} side="top">
              {canSpeak && (
                <DropdownMenuItem onSelect={handleSpeak}>
                  {speaking ? (
                    <Square className="size-3.5 text-status-info" />
                  ) : (
                    <Volume2 className="size-3.5" />
                  )}
                  {speaking ? 'Stop reading' : 'Read aloud'}
                </DropdownMenuItem>
              )}
              {role === 'assistant' && onOpenReplay && (
                <DropdownMenuItem onSelect={onOpenReplay}>
                  <History className="size-3.5" />
                  View tool activity
                </DropdownMenuItem>
              )}
              {role === 'assistant' && onOpenThread && (
                <DropdownMenuItem onSelect={onOpenThread}>
                  <MessagesSquare className="size-3.5" />
                  <span className="flex-1">Open thread</span>
                  {threadCount > 0 && (
                    <span className="font-variant-numeric-tabular text-2xs text-text-faint">
                      {threadCount}
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {role === 'user' && onRollback && (
                <>
                  {(canSpeak || onOpenReplay || onOpenThread) && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => setConfirmOpen(true)} tone="danger">
                    <CornerUpLeft className="size-3.5" />
                    Roll back
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {role === 'assistant' && sources && <MessageSources {...sources} />}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Roll back this message?"
        description="This message and all replies after it will be removed. The text will be restored to the input."
        confirmLabel="Roll back"
        onConfirm={() => {
          setConfirmOpen(false)
          onRollback?.()
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  )
}
