/**
 * The one table recipe for a database object's metadata grids: the read-only Columns, Indexes and
 * Relations views and the editable structure editor.
 *
 * The defect it stops: four hand-copied `<table>` blocks, each restating the wrapper, the header
 * fill and the row hover. They had drifted into a `bg-surface-raised/50` header — a darker ground
 * than the pane, so the header read as a black band — and a `/40` hover step no other list in the
 * workbench uses. Written once, the header takes the same foreground veil as every other panel
 * header fill and the rows the same hover as every other list.
 *
 * `overflow-x-auto`, NOT `overflow-hidden`, on the wrapper: each table sets a min-width, and a
 * clipping wrapper simply CUT it off — in any pane narrower than the table the last columns were
 * unreachable with no scrollbar anywhere. The horizontal scroll lives on the box that owns the
 * width, and the border still rounds.
 */
import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Row hover shared by every structure grid row that has no status tint of its own. */
export const STRUCTURE_ROW_HOVER = 'hover:bg-surface-hover'

export interface StructureTableColumn {
  label: ReactNode
  /** A literal width class (`w-[38%]`) — Tailwind only sees literal strings. */
  width: string
  /** Header-cell padding/alignment; defaults to the read-only grid's `px-3 py-2`. */
  className?: string
  /** For a header cell with no visible label (the actions column). */
  ariaLabel?: string
}

export function StructureTable({
  minWidth,
  columns,
  children,
}: {
  /** A literal min-width class (`min-w-[640px]`). */
  minWidth: string
  columns: readonly StructureTableColumn[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border-soft scrollbar-thin">
      <table className={cn('w-full table-fixed border-collapse', minWidth)}>
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} className={column.width} />
          ))}
        </colgroup>
        <thead className="bg-foreground/[0.04] text-left text-3xs font-medium uppercase tracking-wide text-text-faint">
          <tr className="border-b border-border-soft">
            {columns.map((column, index) => (
              <th
                key={index}
                aria-label={column.ariaLabel}
                className={column.className ?? 'px-3 py-2'}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">{children}</tbody>
      </table>
    </div>
  )
}
