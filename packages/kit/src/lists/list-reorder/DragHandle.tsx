import { GripVertical } from 'lucide-react'
import { cn, CONTROL_FOCUS_VISIBLE } from '@localixai/plugin-sdk/ui/classes'
import type { ReorderHandleProps } from './useListReorder'

/**
 * The grip that says "this row can be moved", and the keyboard path that moves it.
 *
 * LEADING, not trailing. Every settings list surveyed that has one puts it first: the handle
 * marks the row's edge as the thing you pick it up by, and a grip on the right competes with
 * the row's own verbs. HANDLE-ONLY, not a draggable row, because these rows hold inputs — a
 * whole-row drag source fights text selection in them.
 *
 * It is a real `<button>`, so the gesture is not mouse-only: `Alt+ArrowUp` / `Alt+ArrowDown`
 * move the focused row, and `aria-keyshortcuts` says so. Native HTML5 drag reaches neither a
 * keyboard nor a touch screen, so a grip without this is a control half the people using it
 * cannot operate.
 */
export function DragHandle({
  handleProps,
  label,
  className,
}: {
  /** From `useListReorder().rowProps(id).handle`. */
  handleProps: ReorderHandleProps
  /** What this row is, for the control's accessible name ("Rule 3"). */
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-slot="drag-handle"
      aria-label={`Reorder ${label}`}
      title="Drag to reorder, or Alt+↑ / Alt+↓"
      className={cn(
        'flex size-6 shrink-0 touch-none items-center justify-center rounded-sm text-text-faint',
        'transition-opacity hover:text-text-soft',
        // Dimmed, never hidden. A gesture nobody can see is a gesture nobody finds, and
        // `opacity-0` reserves the width anyway — the row would keep the gutter and lose
        // the affordance, which is the worst of both.
        'opacity-40 group-hover/reorder-row:opacity-100 group-focus-within/reorder-row:opacity-100 focus-visible:opacity-100',
        'cursor-grab active:cursor-grabbing',
        CONTROL_FOCUS_VISIBLE,
        className,
      )}
      {...handleProps}
    >
      <GripVertical aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </button>
  )
}
