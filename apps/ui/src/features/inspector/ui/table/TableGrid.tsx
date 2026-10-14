import { useEffect, useRef, useState } from 'react'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpRight, Filter, Maximize2, Pencil, Trash2, Undo2, Check, X } from 'lucide-react'
import { GridFooter } from './GridFooter'
import { EmptyHint } from '@localixai/kit/empty-hint'
import {
  formatCell,
  resolveAlign,
  type SortSpec,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@localixai/kit/context-menu'
import { cellToText, rowToJson } from '@/shared/lib/tableRowCopy'
import { CellValueViewer, type CellView } from './CellValueViewer'
import { HeaderCell } from './HeaderCell'
import { CellEditor } from './CellEditor'
import { GRID_TEMPLATE_VAR, useColumnLayout } from './useColumnLayout'
import { useRowMutations, type StagedChanges } from './useRowMutations'
import { Input } from '@localixai/kit/input'
import type { PluginTableGridProps } from '@localixai/plugin-sdk/ui'

const ROW_H = 30

/**
 * A glyph action in the row-number gutter (insert, discard, delete). Two sit side by side in a
 * column sized for a row number, so they stay bare glyph buttons rather than 20px IconButtons —
 * but they share one shape and carry the focus edge they each used to lack.
 */
const GUTTER_ACTION =
  'cursor-pointer rounded-sm p-0.5 outline-none transition-colors duration-(--dur-fast) focus-ring'

/** The hover-revealed glyph chips over a cell (filter by value, follow a reference, expand). */
const CELL_ACTION =
  'rounded-md border border-control-border bg-surface-raised/90 p-0.5 outline-none backdrop-blur transition-[color,opacity] duration-(--dur-fast) focus-ring'

interface TableGridProps {
  columns: TableColumn[]
  rows: TableRow[]
  /** Total rows after filtering — drives the "showing N of M" gap. */
  total: number
  sort?: SortSpec
  onToggleSort: (columnId: string) => void
  /** Called as the scroll approaches the loaded tail, to append the next page. */
  onReachEnd: () => void
  /** Optional: make rows clickable (e.g. to open a row editor). Index into `rows`. */
  onRowActivate?: (index: number) => void
  /**
   * Opt-in editing seam. The grid stays DB-agnostic — it only EMITS edit intents;
   * it knows nothing about SQL. A consumer that leaves these unset (e.g. the
   * read-only spreadsheet Table tab) gets the current read-only grid.
   */
  editable?: boolean
  /**
   * Optional per-column edit gate. When omitted every column is editable; query-result
   * consumers pass only columns proven to map to physical source columns.
   */
  editableColumns?: Set<string>
  /**
   * Commit an in-place cell edit. `next` is the raw text the user typed, or `null`
   * for an explicit NULL. The consumer coerces by column type + builds the mutation.
   */
  onCellEdit?: (row: TableRow, columnId: string, next: string | null) => void
  /** Commit a new row. `values` is keyed by column id; blank = NULL (consumer decides). */
  onAddRow?: (values: Record<string, string | null>) => void
  /** Delete an existing row. */
  onDeleteRow?: (row: TableRow) => void
  /** Opt-in: show each column's cell type as a muted badge in the header (DB results). */
  showColumnTypes?: boolean
  showColumnIcons?: boolean
  showRowNumbers?: boolean
  showCellActions?: boolean
  allowNullValues?: boolean
  columnActions?: PluginTableGridProps['columnActions']
  /** Column ids that are part of the table's primary key — get a key glyph in the header. */
  pkColumns?: Set<string>
  /**
   * Per-column header filter. When wired, each header shows a funnel that opens a small
   * inline input; submitting calls this with the typed text. Falls back to `onCellFilter`
   * (equality) when unset. The DB console maps it to a server-side `col LIKE %value%`.
   */
  onColumnFilter?: (columnId: string, value: string) => void
  /** Column ids whose cells are foreign-key links (a hover ↗ opens the referenced row). */
  linkColumns?: Set<string>
  /** Invoked when a link cell's ↗ is clicked, with the column id + the cell value. */
  onCellLink?: (columnId: string, value: unknown) => void
  /** When set, cells get a right-click menu with "Filter by this value" (+ copy helpers). */
  onCellFilter?: (columnId: string, value: unknown) => void
  /** Staged-edit mode: when provided, cell edits AND row deletes accumulate as pending
   *  changes (dirty highlight / strike-through + a Commit/Discard bar) and are applied as
   *  ONE batch on Commit — instead of the immediate `onCellEdit` / `onDeleteRow` writes.
   *  Resolve false to keep the staged state (e.g. the batch failed). See useRowMutations. */
  onCommitChanges?: (changes: StagedChanges) => Promise<boolean>
  /**
   * An extra row-copy action appended to each data row's right-click menu (below "Copy
   * cell value" + "Copy row as JSON"). The owning feature supplies the label + a pure
   * `toText(columns,row)` builder, keeping this grid subsystem-agnostic — e.g. the
   * database console passes a "Copy row as INSERT" action. Absent → only the two generic
   * copy actions are offered (the read-only inspector Table tab, an ad-hoc query result).
   */
  extraRowCopy?: {
    label: string
    toText: (columns: TableColumn[], row: TableRow) => string
  }
}

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
            <div
              role="row"
              aria-rowindex={2}
              aria-label="New row draft"
              // A visible neutral veil, not `bg-accent/5` over `border-accent/40`: `accent` is
              // itself a 6% veil under glass, so those were a 0.3% fill behind a 2.4% hairline —
              // the "unsaved row" marking was invisible on every theme.
              className="grid border-b border-border bg-surface-hover"
              style={{ gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})`, height: ROW_H }}
            >
              <div
                role="cell"
                aria-colindex={1}
                className="flex items-center justify-center gap-0.5 border-r border-border-faint px-1"
              >
                <button
                  type="button"
                  title="Insert row"
                  aria-label="Insert row"
                  onClick={commitDraft}
                  className={cn(GUTTER_ACTION, 'text-status-success hover:bg-surface-hover')}
                >
                  <Check className="size-3" />
                </button>
                <button
                  type="button"
                  title="Discard"
                  aria-label="Discard new row"
                  onClick={cancelDraft}
                  className={cn(GUTTER_ACTION, 'text-text-faint hover:bg-surface-hover')}
                >
                  <X className="size-3" />
                </button>
              </div>
              {columns.map((col, columnIndex) => (
                <div
                  key={col.id}
                  role="cell"
                  aria-colindex={columnIndex + 2}
                  className="flex items-center border-r border-border-faint px-1 last:border-r-0"
                >
                  <Input
                    aria-label={`New ${col.title}`}
                    value={draft[col.id] ?? ''}
                    disabled={!!editableColumns && !editableColumns.has(col.id)}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [col.id]: e.target.value } : d))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitDraft()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelDraft()
                      }
                    }}
                    placeholder="NULL"
                    spellCheck={false}
                    // Focus fill = the shared field veil, not `bg-surface-raised`: raised mixes
                    // from a darker ground than the grid, so the focused cell turned black.
                    // `focus-ring` rather than the field's outward ring: the cell clips overflow,
                    // so an outward indicator loses its right and bottom edges.
                    className="h-6 min-w-0 flex-1 rounded-sm border-transparent bg-transparent px-1 py-0.5 text-xs focus:bg-foreground/[0.04] focus-ring disabled:opacity-35"
                  />
                </div>
              ))}
            </div>
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
                      className={cn(
                        'group/row absolute left-0 grid w-full border-b border-border-soft hover:bg-surface-hover',
                        rowClickActivates && 'cursor-pointer',
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
                        aria-colindex={1}
                        onContextMenu={() => {
                          ctxCol.current = null
                        }}
                        className="relative flex items-center justify-end border-r border-border-faint px-2 text-2xs tabular-nums text-text-faint select-none"
                      >
                        {editable ? (
                          <div className="hidden items-center gap-0.5 group-hover/row:flex">
                            {onRowActivate && (
                              <button
                                type="button"
                                title="Edit row in the editor"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRowActivate(vi.index)
                                }}
                                className={cn(
                                  GUTTER_ACTION,
                                  'text-text-faint hover:text-foreground',
                                )}
                              >
                                <Pencil className="size-2.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                title={
                                  markedDelete
                                    ? 'Undo delete'
                                    : staged
                                      ? 'Mark row for deletion'
                                      : 'Delete row'
                                }
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleDelete(row)
                                }}
                                className={cn(
                                  GUTTER_ACTION,
                                  markedDelete
                                    ? 'text-status-error'
                                    : 'text-text-faint hover:text-status-error',
                                )}
                              >
                                {markedDelete ? (
                                  <Undo2 className="size-2.5" />
                                ) : (
                                  <Trash2 className="size-2.5" />
                                )}
                              </button>
                            )}
                          </div>
                        ) : null}
                        <span className={cn(editable && 'group-hover/row:hidden')}>
                          {showRowNumbers ? vi.index + 1 : null}
                        </span>
                      </div>
                      {columns.map((col, columnIndex) => {
                        const columnEditable = canEditColumn(col.id)
                        // A staged edit overrides the row's stored value (dirty) until Commit.
                        const stagedRow = pendingEdits.get(row)
                        const isDirty = !!stagedRow && col.id in stagedRow
                        const value = isDirty ? stagedRow[col.id] : row[col.id]
                        const isNull = value === null || value === undefined
                        const text = isNull ? '' : formatCell(value)
                        const isLink = !isNull && !!onCellLink && !!linkColumns?.has(col.id)
                        const isEditing = editing?.row === row && editing.columnId === col.id
                        if (isEditing) {
                          return (
                            // While a cell is being edited, keep the browser's native input menu
                            // (paste) — don't open the row menu — by stopping the contextmenu here.
                            <div
                              key={col.id}
                              role="cell"
                              aria-colindex={columnIndex + 2}
                              onContextMenu={(e) => e.stopPropagation()}
                              className="flex items-center border-r border-border-faint px-1 last:border-r-0"
                            >
                              <CellEditor
                                allowNull={allowNullValues}
                                initial={text}
                                label={col.title}
                                onCommit={(next) => commitEdit(row, col.id, next)}
                                onCancel={() => setEditing(null)}
                              />
                            </div>
                          )
                        }
                        return (
                          <div
                            key={col.id}
                            role="cell"
                            aria-colindex={columnIndex + 2}
                            onContextMenu={() => {
                              ctxCol.current = col.id
                            }}
                            onDoubleClick={
                              columnEditable
                                ? (e) => {
                                    e.stopPropagation()
                                    setEditing({ row, columnId: col.id })
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
                            style={{
                              justifyContent: justify(resolveAlign(col)),
                            }}
                            title={
                              columnEditable
                                ? 'Double-click to edit'
                                : editableColumns
                                  ? 'This result column is not a direct table column'
                                  : undefined
                            }
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
                                    className={cn(
                                      CELL_ACTION,
                                      'text-text-faint hover:text-foreground',
                                    )}
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
                                      setViewCell({ title: col.title, text })
                                    }}
                                    className={cn(
                                      CELL_ACTION,
                                      'text-text-faint hover:text-foreground',
                                    )}
                                  >
                                    <Maximize2 className="size-3" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
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

function justify(align: ReturnType<typeof resolveAlign>): string {
  return align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
}
