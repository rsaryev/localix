/**
 * RIGHT-CLICK ON A MESSAGE: react, or act on it.
 *
 * The shape is the one every chat that has reactions converged on, and Telegram Desktop's own
 * source says why it is not a button in the layout: its add-reaction control is a hover overlay
 * whose default state is `Hidden` (`history_view_reactions_button.h`), so it costs the
 * transcript no space at all. A standing button under every bubble is furniture down the whole
 * conversation, and the first version of this had exactly that — an empty row under a message
 * with nothing in it.
 *
 * So the marks live in two places and neither is a permanent control:
 *
 *   the chips   — under the message, rendered only when someone has actually reacted;
 *   this menu   — a strip of the available marks across the top, then the message's actions.
 *
 * The strip is ON TOP rather than an item in the list because reacting is the cheap, common
 * gesture and the list is the rare one; putting it first is what makes a single right-click and
 * a single further click the whole interaction.
 */
import type { ReactNode } from 'react'
import { MESSAGE_REACTIONS as AGENT_REACTIONS } from '@localixai/api/message-reactions'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { POPOVER_MATERIAL, POPOVER_SURFACE } from '@localixai/kit/popover-surface'
import { useMessageReaction } from '../model/useMessageReaction'
import { MessageReactions, ownReactions, type MessageReaction } from './MessageReactions'

/**
 * The card's whole reaction surface in one place: right-click to add, chips to see and toggle.
 *
 * Both halves need the same three things — the session, the message, and its marks — so a
 * caller that wired them separately would state all three twice and could wire one and forget
 * the other. The card asks for `chips` where the row should appear and wraps the rest.
 */
export function useMessageReactionSurface(args: {
  sessionId: string | null
  messageId: string
  reactions: readonly MessageReaction[] | undefined
  align?: 'start' | 'end'
  /** A message still being written has nothing to react to yet. */
  disabled?: boolean
}) {
  const toggle = useMessageReaction(args.sessionId, args.messageId)
  return {
    chips: (
      <MessageReactions
        reactions={args.reactions}
        onToggle={toggle}
        align={args.align ?? 'start'}
      />
    ),
    menuProps: {
      onReact: toggle,
      mine: ownReactions(args.reactions),
      disabled: !args.sessionId || args.disabled === true,
    },
  }
}

export function MessageContextMenu({
  children,
  onReact,
  /** Marks this viewer has already placed, so the strip can show them as on. */
  mine,
  /** The message's own actions, rendered as menu items under the strip. */
  actions,
  disabled,
}: {
  children: ReactNode
  onReact: (emoji: string) => void
  mine?: readonly string[]
  actions?: ReactNode
  disabled?: boolean
}) {
  if (disabled) return <>{children}</>
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* The Content box carries NO surface of its own — `lx-floating-surface` brings a
          border, a ring, a shadow and a blur, and each has to be cancelled by name or the two
          cards inside end up boxed in a third. Telegram draws the strip and the menu as two
          separate slabs with a gap, which is what makes the strip read as floating above the
          menu rather than as its first row. */}
      <ContextMenuContent className="border-0 bg-transparent p-0 shadow-none ring-0 backdrop-blur-none">
        {/* Each slab is the shared floating material, cut to its own shape — a pill for the
            strip, a panel for the actions — so both frost and rim like every other menu. They
            were a hand-mixed `bg-popover` + `shadow-lg`, the only menu slabs without either. */}
        <div
          className={cn(
            POPOVER_MATERIAL,
            'mb-1.5 flex items-center gap-0.5 rounded-full border border-control-border p-1',
          )}
        >
          {Object.entries(AGENT_REACTIONS).map(([emoji, meaning]) => {
            const on = mine?.includes(emoji)
            return (
              <button
                key={emoji}
                type="button"
                title={meaning}
                // Not a menu item: a row with a label, seven times over, would bury the actions
                // this menu also has to offer. A strip reads as one control.
                onClick={() => onReact(emoji)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-lg leading-none outline-none transition-colors hover:bg-surface-hover focus-ring',
                  on && 'bg-accent/25 ring-1 ring-accent/50',
                )}
              >
                {emoji}
              </button>
            )
          })}
        </div>
        {actions ? <div className={cn(POPOVER_SURFACE, 'min-w-[12rem] p-1')}>{actions}</div> : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
