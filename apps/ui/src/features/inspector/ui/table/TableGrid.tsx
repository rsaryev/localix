import { useEffect, useRef, useState } from 'react'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X } from 'lucide-react'
import { EmptyHint } from '@localixai/kit/empty-hint'
import type { TableRow } from '@localixai/dataview'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@localixai/kit/context-menu'
import { cellToText, rowToJson } from '@/shared/lib/tableRowCopy'
import { CellValueViewer, type CellView } from './CellValueViewer'
import { GridFooter } from './GridFooter'
import { HeaderCell } from './HeaderCell'
import { TableDataCell } from './TableDataCell'
import { TableDraftRow } from './TableDraftRow'
import { GUTTER_ACTION, ROW_H } from './tableGridModel'
import { TableRowActions } from './TableRowActions'
import type { TableGridProps } from './tableGridProps'
import { GRID_TEMPLATE_VAR, useColumnLayout } from './useColumnLayout'
import { useRowMutations } from './useRowMutations'

export type { TableGridProps } from './tableGridProps'

/**
 * Virtualized data grid built on @tanstack/react-virtual. Only the visible rows
 * mount; the body is a single spacer sized to the loaded row count with rows
 * translated into place. Header + rows share one CSS-grid template so columns
 * stay aligned through horizontal scroll.
 *
 * Editing (opt-in via `editable` + the `on*` callbacks) is a generic seam: cells
 * edit in place on double-click, a draft row appends new rows, and a per-row trash
 * deletes — all emitted as agnostic intents the consumer turns into SQL.
 */
export function TableGrid({
  columns,
  rows,
  total,
  sort,
  onToggleSort,
  onReachEnd,
  onRowActivate,
  editable,
  editableColumns,
  onCellEdit,
  onAddRow,
  onDeleteRow,
  showColumnTypes,
  pkColumns,
  linkColumns,
  onCellLink,
  onCellFilter,
  onColumnFilter,
  onCommitChanges,
  extraRowCopy,
  showColumnIcons = true,
  showRowNumbers = true,
  showCellActions = true,
  allowNullValues = true,
  columnActions,
}: TableGridProps) {
  const workItemVisible = useWorkItemVisible()
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [viewCell, setViewCell] = useState<CellView | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setScrollEl(scrollRef.current)
  }, [])

  // Every write the grid can emit — immediate or staged-into-a-batch. See useRowMutations.
  const {
    staged,
    editing,
    setEditing,
    commitEdit,
    draft,
    setDraft,
    startDraft,
    commitDraft,
    cancelDraft,
    pendingEdits,
    pendingInserts,
    pendingDeletes,
    toggleDelete,
    removeInsert,
    editCellCount,
    pendingCount,
    committing,
    clearStaged,
    commitChanges,
  } = useRowMutations(columns, {
    onCellEdit,
    onAddRow,
    onDeleteRow,
    onCommitChanges,
  })

  // The column id of the last right-clicked cell, for the row context menu's "Copy cell
  // value". A ref (not state) so it is synchronously correct by the time an item's onSelect
  // fires; a gutter right-click clears it (menu falls back to the first column).
  const ctxCol = useRef<string | null>(null)
  // `await navigator.clipboard?.writeText(...)` used to RESOLVE when the API was absent
  // (an insecure context), so this toasted "Copied to clipboard" with an untouched clipboard.
  const copy = (text: string, label: string) => {
    void copyText(text, label)
  }

  const startEdit = (row: TableRow, columnId: string) => setEditing({ row, columnId })
  const cancelEdit = () => setEditing(null)

  const canEditCells = !!(!committing && editable && (onCellEdit || onCommitChanges))
  const canEditColumn = (columnId: string) =>
    canEditCells && (!editableColumns || editableColumns.has(columnId))
  const canDelete = !!(!committing && editable && (onDeleteRow || onCommitChanges))
  // INSERT does not require a primary key. A database table without one must still expose
  // Add row even though editing/deleting existing rows cannot be made unambiguous.
  const canAdd = !committing && !!(onAddRow || onCommitChanges)
  // In editable mode a whole-row click no longer opens the editor (double-click edits a
  // cell instead); the row detail/drawer is reached via the hover pencil.
  const rowClickActivates = !!onRowActivate && !editable

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_H,
    overscan: 16,
    enabled: workItemVisible,
  })

  const items = v.getVirtualItems()
  const lastIndex = items.length > 0 ? items[items.length - 1]!.index : 0
  useEffect(() => {
    if (workItemVisible && rows.length > 0 && lastIndex >= rows.length - 12) onReachEnd()
  }, [lastIndex, rows.length, onReachEnd, workItemVisible])

  // The ONE grid-template the header, body rows, draft row and staged inserts all share
  // (identical tracks are what keeps them aligned through horizontal scroll).
  const { gridTemplate, widths, rootRef, startResize, resizeWithKeyboard, resetWidth } =
    useColumnLayout(columns, rows.length, total)
  // ARIA row coordinates describe the complete table, including unloaded virtual rows and
  // temporary edit rows. Keeping these offsets explicit prevents draft and staged rows from
  // colliding with data-row indices when assistive technology traverses the table.
  const accessibleDataRowCount = Math.max(total, rows.length)
  const draftRowOffset = draft ? 1 : 0
  const accessibleRowCount = 1 + draftRowOffset + accessibleDataRowCount + pendingInserts.length

  return (
    // Column layout: the scroll area flexes, the Add-row button + staged Commit bar sit
    // BELOW it as always-visible footers. (A plain fragment with an h-full scroll area
    // pushed these off-screen — the root cause of "Commit / Add row don't work".)
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin virtual-scroller">
        {/* Inner wrapper sizes to content (min the container) so the header in-flow
          establishes the scroll width that absolute rows match at width:100%. */}
        <div
          ref={rootRef}
          role="table"
          tabIndex={-1}
          aria-label="Data table"
          aria-colcount={columns.length + 1}
          aria-rowcount={accessibleRowCount}
          className="relative w-max min-w-full text-xs outline-none"
          style={{ [GRID_TEMPLATE_VAR]: gridTemplate } as React.CSSProperties}
        >
          {/* Header — `/95`, not plain `bg-background`: under glass the nested ground coat is
              cleared by the once-only rule (rows bled through the sticky header); the alpha
              variant escapes it and keeps the occluding pane-hue coat. */}
          <div
            role="row"
            aria-rowindex={1}
            className="lx-occluder sticky top-0 z-(--z-sticky) grid border-b border-border"
            style={{ gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})` }}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              className="flex h-7 items-center justify-end border-r border-border-soft px-2 text-text-faint"
            >
              {showRowNumbers ? '#' : null}
            </div>
            {columns.map((col, columnIndex) => (
              <HeaderCell
                key={col.id}
                col={col}
                active={sort?.columnId === col.id}
                dir={sort?.dir}
                isPk={!!pkColumns?.has(col.id)}
                showColumnTypes={showColumnTypes}
                onToggleSort={onToggleSort}
                onColumnFilter={onColumnFilter}
                onCellFilter={onCellFilter}
                onResizeStart={startResize}
                onResizeKeyDown={resizeWithKeyboard}
                onResetWidth={resetWidth}
                columnIndex={columnIndex + 2}
                columnWidth={widths[col.id]}
                showColumnIcons={showColumnIcons}
                columnActions={editable && !pendingCount && !committing ? columnActions : undefined}
                columnCount={columns.length}
              />
            ))}
          </div>

          {/* Draft new-row (in flow, aligned + horizontally scrolled with the grid). */}
          {draft && (
            <TableDraftRow
              columns={columns}
              draft={draft}
              setDraft={setDraft}
              editableColumns={editableColumns}
              commitDraft={commitDraft}
              cancelDraft={cancelDraft}
            />
          )}

          {/* Body */}
          <div role="rowgroup" className="relative" style={{ height: v.getTotalSize() }}>
            {items.map((vi) => {
              const row = rows[vi.index]
              if (!row) return null
              const markedDelete = pendingDeletes.has(row)
              return (
                // Right-click a data row for clipboard actions (Copy cell / row JSON / row
                // INSERT). Radix ContextMenu triggers on `contextmenu` only — left-click
                // (row-activate) and double-click (cell edit) are untouched.
                <ContextMenu key={vi.key}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="row"
                      aria-rowindex={vi.index + 2 + draftRowOffset}
                      onClick={rowClickActivates ? () => onRowActivate!(vi.index) : undefined}
                      tabIndex={rowClickActivates ? 0 : undefined}
                      onKeyDown={
                        rowClickActivates
                          ? (e) => {
                              if (e.target !== e.currentTarget) return
                              if (e.key !== 'Enter' && e.key !== ' ') return
                              e.preventDefault()
                              onRowActivate!(vi.index)
                            }
                          : undefined
                      }
                      className={cn(
                        'group/row absolute left-0 grid w-full border-b border-border-soft hover:bg-surface-hover',
                        rowClickActivates && 'cursor-pointer outline-none focus-ring',
                        markedDelete && 'bg-status-error/5 opacity-60',
                      )}
                      style={{
                        gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})`,
                        height: ROW_H,
                        transform: `translateY(${vi.start}px)`,
                        contain: 'layout paint',
                      }}
                    >
                      <div
                        role="rowheader"
                        tabIndex={-1}
                        aria-colindex={1}
                        onContextMenu={() => {
                          ctxCol.current = null
                        }}
                        className="relative flex items-center justify-end border-r border-border-faint px-2 text-2xs tabular-nums text-text-faint select-none"
                      >
                        {editable ? (
                          <TableRowActions
                            markedDelete={markedDelete}
                            staged={staged}
                            onEdit={onRowActivate ? () => onRowActivate(vi.index) : undefined}
                            onToggleDelete={canDelete ? () => toggleDelete(row) : undefined}
                          />
                        ) : null}
                        <span className={cn(editable && 'group-hover/row:hidden')}>
                          {showRowNumbers ? vi.index + 1 : null}
                        </span>
                      </div>
                      {columns.map((col, columnIndex) => (
                        <TableDataCell
                          key={col.id}
                          col={col}
                          columnIndex={columnIndex}
                          row={row}
                          stagedRow={pendingEdits.get(row)}
                          isEditing={editing?.row === row && editing.columnId === col.id}
                          columnEditable={canEditColumn(col.id)}
                          hasEditGate={!!editableColumns}
                          isLinkColumn={!!linkColumns?.has(col.id)}
                          showCellActions={showCellActions}
                          allowNullValues={allowNullValues}
                          onContextColumn={(columnId) => {
                            ctxCol.current = columnId
                          }}
                          onStartEdit={startEdit}
                          onCommitEdit={commitEdit}
                          onCancelEdit={cancelEdit}
                          onCellFilter={onCellFilter}
                          onCellLink={onCellLink}
                          onViewCell={setViewCell}
                        />
                      ))}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        const colId = ctxCol.current ?? columns[0]?.id
                        if (colId) copy(cellToText(row, colId), 'Cell value')
                      }}
                    >
                      Copy cell value
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => copy(rowToJson(columns, row), 'Row as JSON')}>
                      Copy row as JSON
                    </ContextMenuItem>
                    {extraRowCopy && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() =>
                            copy(extraRowCopy.toText(columns, row), extraRowCopy.label)
                          }
                        >
                          {extraRowCopy.label}
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>

          {/* Staged new rows (batch insert): rendered outside the virtualizer, aligned to the
              column tracks so they share the horizontal scroll. Remove one with the × gutter. */}
          {pendingInserts.length > 0 && (
            // `border-border`, not `border-accent/40`: `accent` is itself a 6% veil under glass, so
            // the dashed rule announcing the staged-insert block was a 2.4% line — invisible.
            <div role="rowgroup" className="border-t-2 border-dashed border-border">
              {pendingInserts.map((insert, insertIndex) => (
                <div
                  key={insert.id}
                  role="row"
                  aria-rowindex={accessibleDataRowCount + draftRowOffset + insertIndex + 2}
                  aria-label="Unsaved new row"
                  // Same visible veil as the draft row above, not the invisible `bg-accent/5`.
                  className="grid w-full border-b border-border-soft bg-surface-hover"
                  style={{ gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})`, height: ROW_H }}
                >
                  <div
                    role="cell"
                    aria-colindex={1}
                    className="flex items-center justify-center border-r border-border-faint px-1 text-text-faint"
                  >
                    <button
                      type="button"
                      title="Remove this new row"
                      aria-label="Remove this new row"
                      onClick={() => removeInsert(insert.id)}
                      className={cn(GUTTER_ACTION, 'text-text-faint hover:text-status-error')}
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                  {columns.map((col, columnIndex) => {
                    const raw = insert.values[col.id]
                    const isBlank = raw == null || raw === ''
                    return (
                      <div
                        key={col.id}
                        role="cell"
                        aria-colindex={columnIndex + 2}
                        className="flex items-center overflow-hidden border-r border-border-faint px-2 last:border-r-0"
                      >
                        {isBlank ? (
                          <span className="text-2xs italic text-text-faint">default</span>
                        ) : (
                          <span className="truncate text-xs text-foreground">{raw}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 && <EmptyHint className="py-16">No rows to display</EmptyHint>}

        {rows.length < total && (
          <div className="px-2 py-1 text-center text-2xs text-text-faint">
            {rows.length.toLocaleString()} of {total.toLocaleString()} rows
          </div>
        )}
      </div>
      <GridFooter
        addRow={canAdd && !draft ? startDraft : undefined}
        addColumn={
          editable && !pendingCount && !committing && columnActions?.insert && columns.length
            ? () => columnActions.insert!(columns.at(-1)!.id, 'after')
            : undefined
        }
        pendingCount={pendingCount}
        edits={editCellCount}
        inserts={pendingInserts.length}
        deletes={pendingDeletes.size}
        committing={committing}
        editing={!!editing || !!draft}
        clear={clearStaged}
        commit={commitChanges}
      />
      <CellValueViewer cell={viewCell} onClose={() => setViewCell(null)} />
    </div>
  )
}
