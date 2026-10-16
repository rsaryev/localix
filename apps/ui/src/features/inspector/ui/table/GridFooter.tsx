import { Check, Plus, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Spinner } from '@localixai/kit/spinner'

const ADD =
  'flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 py-1 text-2xs font-medium text-text-faint outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-foreground'

export function GridFooter({
  addRow,
  addColumn,
  pendingCount,
  edits,
  inserts,
  deletes,
  committing,
  editing,
  clear,
  commit,
}: {
  addRow?: () => void
  addColumn?: () => void
  pendingCount: number
  edits: number
  inserts: number
  deletes: number
  committing: boolean
  editing: boolean
  clear: () => void
  commit: () => Promise<unknown>
}) {
  return (
    <>
      {(addRow || addColumn) && (
        <div className="flex shrink-0 border-t border-border-soft">
          {addRow && (
            <button type="button" onClick={addRow} className={ADD}>
              <Plus className="size-3" />
              Add row
            </button>
          )}
          {addColumn && (
            <button type="button" onClick={addColumn} className={ADD}>
              <Plus className="size-3" />
              Add column
            </button>
          )}
        </div>
      )}
      {pendingCount > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-hover px-3 py-1.5">
          <span className="text-2xs font-medium text-text-soft">
            {[
              edits > 0 && `${edits} edit${edits === 1 ? '' : 's'}`,
              inserts > 0 && `${inserts} new`,
              deletes > 0 && `${deletes} to delete`,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            unsaved
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={clear}
              disabled={committing}
              className="text-text-soft"
            >
              <X className="size-3" />
              Discard
            </Button>
            <Button
              variant="mono"
              size="xs"
              onClick={() => void commit()}
              disabled={committing || editing}
              title={editing ? 'Finish or cancel the current edit before committing' : undefined}
            >
              {committing ? <Spinner className="size-3" /> : <Check className="size-3" />}Commit
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
