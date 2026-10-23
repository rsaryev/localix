import type { MutableRefObject } from 'react'
import { ArrowUpRight, Filter, Maximize2 } from 'lucide-react'
import { formatCell, resolveAlign, type TableColumn, type TableRow } from '@localixai/dataview'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { CellEditor } from './CellEditor'
import type { CellView } from './CellValueViewer'
import { CELL_ACTION, cellTitle, justify } from './tableGridModel'

interface TableDataCellProps {
  col: TableColumn
  columnIndex: number
  row: TableRow
  /** The row's staged edits, when any — they override the stored value until Commit. */
  stagedRow: Record<string, string | null> | undefined
  isEditing: boolean
  columnEditable: boolean
  hasEditGate: boolean
  isLinkColumn: boolean
  showCellActions: boolean
  allowNullValues: boolean
  ctxCol: MutableRefObject<string | null>
  onStartEdit: (row: TableRow, columnId: string) => void
  onCommitEdit: (row: TableRow, columnId: string, next: string | null) => void
  onCancelEdit: () => void
  onCellFilter?: (columnId: string, value: unknown) => void
  onCellLink?: (columnId: string, value: unknown) => void
  onViewCell: (cell: CellView) => void
}

/** One data cell: the in-place editor while editing, else the value + hover actions. */
export function TableDataCell({
  col,
  columnIndex,
  row,
  stagedRow,
  isEditing,
  columnEditable,
  hasEditGate,
  isLinkColumn,
  showCellActions,
  allowNullValues,
  ctxCol,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onCellFilter,
  onCellLink,
  onViewCell,
}: TableDataCellProps) {
  const isDirty = !!stagedRow && col.id in stagedRow
  const value = isDirty ? stagedRow[col.id] : row[col.id]
  const isNull = value === null || value === undefined
  const text = isNull ? '' : formatCell(value)
  const isLink = !isNull && !!onCellLink && isLinkColumn
  if (isEditing) {
    return (
      // While a cell is being edited, keep the browser's native input menu
      // (paste) — don't open the row menu — by stopping the contextmenu here.
      <div
        role="cell"
        aria-colindex={columnIndex + 2}
        onContextMenu={(e) => e.stopPropagation()}
        className="flex items-center border-r border-border-faint px-1 last:border-r-0"
      >
        <CellEditor
          allowNull={allowNullValues}
          initial={text}
          label={col.title}
          onCommit={(next) => onCommitEdit(row, col.id, next)}
          onCancel={onCancelEdit}
        />
      </div>
    )
  }
  return (
    <div
      role="cell"
      aria-colindex={columnIndex + 2}
      onContextMenu={() => {
        ctxCol.current = col.id
      }}
      onDoubleClick={
        columnEditable
          ? (e) => {
              e.stopPropagation()
              onStartEdit(row, col.id)
            }
          : undefined
      }
      className={cn(
        'group/cell relative flex items-center overflow-hidden border-r border-border-faint px-2 last:border-r-0',
        columnEditable && 'cursor-text',
        // Visible veil + a real hairline ring, not `bg-accent/10` over
        // `ring-accent/30`: `accent` is itself a 6% veil under glass, so an
        // EDITED cell was marked with a 0.6% fill and a 1.8% ring.
        isDirty && 'bg-surface-active ring-1 ring-inset ring-border',
      )}
      style={{ justifyContent: justify(resolveAlign(col)) }}
      title={cellTitle(columnEditable, hasEditGate)}
    >
      {/* NULL renders as a muted marker so it is distinguishable from an empty string. */}
      {isNull ? (
        <span className="select-none text-2xs uppercase italic tracking-wide text-text-faint">
          null
        </span>
      ) : (
        <span className="truncate tabular-nums text-foreground">{text}</span>
      )}
      {/* Hover affordances, clustered at the right edge (filter · open-FK · expand). */}
      {showCellActions && (
        <div className="absolute top-1/2 right-0.5 hidden -translate-y-1/2 items-center gap-0.5 group-hover/cell:flex">
          {onCellFilter && (
            <button
              type="button"
              title="Filter rows by this value"
              onClick={(e) => {
                e.stopPropagation()
                onCellFilter(col.id, value)
              }}
              className={cn(CELL_ACTION, 'text-text-faint hover:text-foreground')}
            >
              <Filter className="size-3" />
            </button>
          )}
          {isLink && (
            <button
              type="button"
              title="Open referenced row"
              onClick={(e) => {
                e.stopPropagation()
                onCellLink!(col.id, value)
              }}
              className={cn(CELL_ACTION, 'text-status-info hover:opacity-80')}
            >
              <ArrowUpRight className="size-3" />
            </button>
          )}
          {text.length > 0 && (
            <button
              type="button"
              title="View full value"
              onClick={(e) => {
                e.stopPropagation()
                onViewCell({ title: col.title, text })
              }}
              className={cn(CELL_ACTION, 'text-text-faint hover:text-foreground')}
            >
              <Maximize2 className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
