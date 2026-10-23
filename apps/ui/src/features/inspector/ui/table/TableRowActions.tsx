import { Pencil, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { GUTTER_ACTION, deleteActionTitle } from './tableGridModel'

interface TableRowActionsProps {
  markedDelete: boolean
  staged: boolean
  /** Opens the row in the editor; omitted when the consumer has no row editor. */
  onEdit?: () => void
  /** Toggles the row's delete; omitted when rows cannot be deleted. */
  onToggleDelete?: () => void
}

/** The hover-revealed edit / delete glyphs in an editable row's number gutter. */
export function TableRowActions({
  markedDelete,
  staged,
  onEdit,
  onToggleDelete,
}: TableRowActionsProps) {
  return (
    <div className="hidden items-center gap-0.5 group-hover/row:flex">
      {onEdit && (
        <button
          type="button"
          title="Edit row in the editor"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className={cn(GUTTER_ACTION, 'text-text-faint hover:text-foreground')}
        >
          <Pencil className="size-2.5" />
        </button>
      )}
      {onToggleDelete && (
        <button
          type="button"
          title={deleteActionTitle(markedDelete, staged)}
          onClick={(e) => {
            e.stopPropagation()
            onToggleDelete()
          }}
          className={cn(
            GUTTER_ACTION,
            markedDelete ? 'text-status-error' : 'text-text-faint hover:text-status-error',
          )}
        >
          {markedDelete ? <Undo2 className="size-2.5" /> : <Trash2 className="size-2.5" />}
        </button>
      )}
    </div>
  )
}
