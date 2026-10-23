import { Fragment, memo, type ReactNode } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@localixai/kit/context-menu'
import { StatusDot } from '@localixai/kit/status-dot'

import type { KanbanTask } from '../../shared/contracts'
import { KANBAN_STATUS_DOT as STATUS_DOT, KANBAN_STATUS_LABEL } from '../model/kanbanStatus'
import type { CardActions } from './card-actions'
import { cardMenuItems, type CardMenuItem } from './card-menu-items'

// No success row: a copied reference is not an event worth a durable journal entry.
const copyRef = (task: KanbanTask) => void copyText(task.id, 'Task reference')

/** One row. Kept as a plain switch over the model so the menu's CONTENT stays a
 *  tested decision (`card-menu-items.ts`) and this file stays pure presentation. */
function Row({
  item,
  task,
  actions,
}: {
  item: CardMenuItem
  task: KanbanTask
  actions: CardActions
}) {
  switch (item.kind) {
    case 'open':
      return <ContextMenuItem onSelect={() => actions.open(task.id)}>Open</ContextMenuItem>
    case 'copy-ref':
      return (
        <ContextMenuItem onSelect={() => copyRef(task)}>
          <Copy className="size-3 shrink-0 text-text-faint" />
          Copy reference
        </ContextMenuItem>
      )
    case 'move':
      return (
        <ContextMenuItem onSelect={() => actions.quickMove(task.id, item.to)}>
          <StatusDot className={cn('shrink-0', STATUS_DOT[item.to])} />
          Move to {KANBAN_STATUS_LABEL[item.to]}
        </ContextMenuItem>
      )
    case 'delete':
      return (
        <ContextMenuItem tone="danger" onSelect={() => actions.requestDelete(task.id)}>
          <Trash2 className="size-3 shrink-0" />
          Delete
        </ContextMenuItem>
      )
  }
}

/**
 * Right-click menu for a board card.
 *
 * The board otherwise offers one suggested move (the hover quick action) and a
 * one-step-at-a-time Alt+Arrow walk, so sending a card to a specific column cost a
 * drag. kaneo puts the whole column list one right-click away
 * (`apps/web/src/components/kanban-board/task-card.tsx:179-403` wraps the card in a
 * ContextMenu; `task-card-context-menu/task-card-context-menu-content.tsx:174-194`
 * renders every column as a checkable item). We take the shape and drop the
 * checkbox affordance — a card is in exactly one column, so the one it is in is
 * simply absent from the list.
 */
function CardContextMenuImpl({
  task,
  actions,
  children,
}: {
  task: KanbanTask
  actions: CardActions
  children: ReactNode
}) {
  const items = cardMenuItems(task)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {items.map((item, index) => (
          // A Fragment, not a wrapper element: Radix's menu keeps `role="menuitem"`
          // nodes as direct children of the `role="menu"` container.
          <Fragment key={item.kind === 'move' ? `move:${item.to}` : item.kind}>
            {/* Separators bracket the move block; they carry no meaning of their own,
                so they live here rather than in the tested item model. */}
            {(item.kind === 'move' || item.kind === 'delete') &&
              items[index - 1]?.kind !== item.kind && <ContextMenuSeparator />}
            <Row item={item} task={task} actions={actions} />
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const CardContextMenu = memo(CardContextMenuImpl)
CardContextMenu.displayName = 'CardContextMenu'
