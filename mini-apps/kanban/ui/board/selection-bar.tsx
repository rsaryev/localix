import { Ban, Play, Trash2, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { FLOATING_SURFACE, FloatingActionDivider } from '@localixai/kit/workbench-toolbar'

/**
 * Floating batch-action bar for the board's multi-selection. Appears over the
 * columns when one or more cards are selected; its moves route through the same
 * FSM-legal user transitions a drag makes (→ ready / → blocked), plus delete.
 */
export function SelectionBar({
  count,
  onSetReady,
  onBlock,
  onDelete,
  onClear,
}: {
  count: number
  onSetReady: () => void
  onBlock: () => void
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-(--z-controls) flex justify-center">
      <div
        className={`pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 ${FLOATING_SURFACE}`}
      >
        <span className="px-1 text-xs font-medium tabular-nums text-foreground">
          {count} selected
        </span>
        <FloatingActionDivider />
        <Button size="sm" variant="ghost" onClick={onSetReady} title="Move selected to Ready">
          <Play className="size-3" /> Set ready
        </Button>
        <Button size="sm" variant="ghost" onClick={onBlock} title="Move selected to Blocked">
          <Ban className="size-3" /> Block
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          title="Delete selected"
          className="text-status-error hover:text-status-error"
        >
          <Trash2 className="size-3" /> Delete
        </Button>
        <FloatingActionDivider />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClear}
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
