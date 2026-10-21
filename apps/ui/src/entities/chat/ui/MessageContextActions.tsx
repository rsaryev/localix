/**
 * WHAT A RIGHT-CLICK ON A MESSAGE OFFERS, besides reacting.
 *
 * The same verbs the hover row already has, as a menu. Two surfaces for one set is not a
 * duplication to remove: the hover row is for the message you are looking at, and a context
 * menu is for the message you pointed at — people reach for one or the other by habit, and a
 * chat that answers only one of those habits feels broken in a way nobody can name.
 *
 * Every item is omitted rather than disabled when it does not apply. A greyed row is a promise
 * the menu cannot keep, and a menu of six greyed rows says nothing about what this message can
 * actually do.
 */
import { Copy, History, Link2, MessagesSquare, Pencil, Pin, PinOff, Undo2 } from 'lucide-react'

import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'

import { ContextMenuItem, ContextMenuSeparator } from '@localixai/kit/context-menu'

export interface MessageContextActionsProps {
  /** The message's plain text, when it has any to copy. */
  text?: string
  /** Put a `@message:` reference to this message in the composer. */
  onLink?: () => void
  /** The same reference, for dragging the Link button out onto a board or a tab. */
  linkDraft?: () => MessageContextBindingDraft | null
  /** Open this turn's tool activity in the inspector. */
  onOpenReplay?: () => void
  onOpenThread?: () => void
  onEdit?: () => void
  onRollback?: () => void
}

/**
 * Keep the message in the agent's view. Menu-only on purpose: it is a rare, deliberate act, and
 * the hover row is for what people do to the message in front of them many times a day.
 */
export interface MessagePinAction {
  pinned: boolean
  onToggle: () => void
}

export function MessageContextActions({
  text,
  onLink,
  onOpenReplay,
  onOpenThread,
  onEdit,
  onRollback,
  pin,
}: MessageContextActionsProps & { pin?: MessagePinAction }) {
  const { copy } = useCopied()
  const destructive = Boolean(onRollback)
  return (
    <>
      {text ? (
        <ContextMenuItem onSelect={() => void copy(text)}>
          <Copy className="size-3.5" />
          Copy text
        </ContextMenuItem>
      ) : null}
      {onLink ? (
        <ContextMenuItem onSelect={onLink}>
          <Link2 className="size-3.5" />
          Quote in composer
        </ContextMenuItem>
      ) : null}
      {onOpenThread ? (
        <ContextMenuItem onSelect={onOpenThread}>
          <MessagesSquare className="size-3.5" />
          Open thread
        </ContextMenuItem>
      ) : null}
      {onOpenReplay ? (
        <ContextMenuItem onSelect={onOpenReplay}>
          <History className="size-3.5" />
          View tool activity
        </ContextMenuItem>
      ) : null}
      {pin ? (
        <ContextMenuItem onSelect={pin.onToggle}>
          {pin.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {pin.pinned ? 'Unpin from agent context' : 'Pin to agent context'}
        </ContextMenuItem>
      ) : null}
      {onEdit ? (
        <ContextMenuItem onSelect={onEdit}>
          <Pencil className="size-3.5" />
          Edit
        </ContextMenuItem>
      ) : null}
      {destructive ? (
        <>
          {/* Last, behind a rule: rewinding throws away everything said after this message, so
              it must never sit where a mis-aimed click lands. */}
          <ContextMenuSeparator />
          <ContextMenuItem tone="danger" onSelect={onRollback}>
            <Undo2 className="size-3.5" />
            Rewind to here
          </ContextMenuItem>
        </>
      ) : null}
    </>
  )
}
