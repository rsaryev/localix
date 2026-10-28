/** The one treeitem element every schema-tree row renders into, its chevron, and the
 *  non-item rows (status lines and the Indexes label). */
import type { DragEvent, ReactNode } from 'react'
import { AlertCircle, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { isBranch, type SchemaTreeRow, type StatusTreeRow } from '../../model/schemaTreeRows'
import type { SchemaTreeActions } from './actions'
import {
  TREE_CHEVRON,
  TREE_ROW,
  TREE_ROW_IDLE,
  TREE_ROW_SELECTED,
  treeRowStyle,
} from './treeRowRecipe'

export function TreeItem({
  row,
  tabIndex,
  selected,
  actions,
  leaf = false,
  draggable,
  onDragStart,
  title,
  children,
}: {
  row: SchemaTreeRow
  tabIndex: 0 | -1
  selected: boolean
  actions: SchemaTreeActions
  leaf?: boolean
  draggable?: boolean
  onDragStart?: (event: DragEvent) => void
  title?: string
  children: ReactNode
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- ARIA tree pattern: Enter and Space on a focused row are handled by the role=tree container's delegated onKeyDown (SchemaTree)
    <div
      role="treeitem"
      data-row-key={row.key}
      tabIndex={tabIndex}
      aria-level={row.depth + 1}
      aria-expanded={isBranch(row) ? row.open : undefined}
      aria-selected={selected}
      draggable={draggable}
      onDragStart={onDragStart}
      title={title}
      onClick={() => actions.activate(row)}
      style={treeRowStyle(row.depth, leaf)}
      className={cn(TREE_ROW, selected ? TREE_ROW_SELECTED : TREE_ROW_IDLE)}
    >
      {children}
    </div>
  )
}

/** The disclosure chevron. Not a tab stop: the row is, and ArrowRight/Left open and close it. */
export function TreeChevron({
  row,
  label,
  actions,
}: {
  row: SchemaTreeRow & { open: boolean }
  label: string
  actions: SchemaTreeActions
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${row.open ? 'Collapse' : 'Expand'} ${label}`}
      className="shrink-0 rounded-sm outline-none"
      onClick={(event) => {
        event.stopPropagation()
        actions.setOpen(row, !row.open)
      }}
    >
      <ChevronRight className={cn(TREE_CHEVRON, 'block', row.open && 'rotate-90')} />
    </button>
  )
}

const STATUS_TEXT: Record<Exclude<StatusTreeRow['status'], 'problem' | 'columns-error'>, string> = {
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  loading: 'Loading schema…',
  'no-objects': 'No database objects',
  empty: 'Empty',
  'columns-loading': 'Reading columns…',
}

export function StatusRowView({
  row,
  actions,
}: {
  row: StatusTreeRow
  actions: SchemaTreeActions
}) {
  const style = treeRowStyle(row.depth, true)
  if (row.status === 'problem') {
    return (
      <div role="none" className="min-h-6 py-1 pr-2" style={style}>
        {row.line ? (
          <ProblemLine {...row.line} />
        ) : (
          <span className="text-2xs text-text-soft">{row.message}</span>
        )}
      </div>
    )
  }
  if (row.status === 'columns-error') {
    return (
      <div role="none" className="flex h-6 items-center pr-2" style={style}>
        {/* A failed read is a dead end, not a slow one: a `…` used to sit here forever. */}
        <button
          type="button"
          onClick={() => actions.retryColumns(row)}
          title={row.message}
          className="flex min-w-0 items-center gap-1 rounded-sm text-2xs text-text-soft outline-none hover:text-foreground hover:underline focus-ring"
        >
          <AlertCircle className="size-3 shrink-0 text-status-error/70" />
          <span className="truncate">Could not read columns — retry</span>
        </button>
      </div>
    )
  }
  return (
    <div
      role="none"
      className="flex h-6 items-center truncate pr-2 text-2xs text-text-faint"
      style={style}
    >
      {STATUS_TEXT[row.status]}
    </div>
  )
}

export function IndexLabelRowView({ row }: { row: SchemaTreeRow }) {
  return (
    <div
      role="none"
      className="flex h-6 items-center pr-2 text-2xs font-medium uppercase tracking-wider text-text-faint"
      style={treeRowStyle(row.depth, true)}
    >
      Indexes
    </div>
  )
}
