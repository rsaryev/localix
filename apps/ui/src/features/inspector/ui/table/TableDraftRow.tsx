import type { SetStateAction } from 'react'
import { Check, X } from 'lucide-react'
import type { TableColumn } from '@localixai/dataview'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Input } from '@localixai/kit/input'
import { GRID_TEMPLATE_VAR } from './useColumnLayout'
import { GUTTER_ACTION, ROW_H } from './tableGridModel'

type Draft = Record<string, string | null>

interface TableDraftRowProps {
  columns: TableColumn[]
  draft: Draft
  setDraft: (next: SetStateAction<Draft | null>) => void
  editableColumns?: Set<string>
  commitDraft: () => void
  cancelDraft: () => void
}

/** Draft new-row (in flow, aligned + horizontally scrolled with the grid). */
export function TableDraftRow({
  columns,
  draft,
  setDraft,
  editableColumns,
  commitDraft,
  cancelDraft,
}: TableDraftRowProps) {
  return (
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
  )
}
