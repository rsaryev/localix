import type { resolveAlign } from '@localixai/dataview'

export const ROW_H = 30

/**
 * A glyph action in the row-number gutter (insert, discard, delete). Two sit side by side in a
 * column sized for a row number, so they stay bare glyph buttons rather than 20px IconButtons —
 * but they share one shape and carry the focus edge they each used to lack.
 */
export const GUTTER_ACTION =
  'cursor-pointer rounded-sm p-0.5 outline-none transition-colors duration-(--dur-fast) focus-ring'

/** The hover-revealed glyph chips over a cell (filter by value, follow a reference, expand). */
export const CELL_ACTION =
  'rounded-md border border-control-border lx-occluder p-0.5 outline-none transition-[color,opacity] duration-(--dur-fast) focus-ring'

export function justify(align: ReturnType<typeof resolveAlign>): string {
  return align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
}

/** Tooltip of the gutter delete toggle. */
export function deleteActionTitle(markedDelete: boolean, staged: boolean): string {
  return markedDelete ? 'Undo delete' : staged ? 'Mark row for deletion' : 'Delete row'
}

/** Tooltip of a data cell: editable, a non-physical result column, or none. */
export function cellTitle(columnEditable: boolean, hasEditGate: boolean): string | undefined {
  if (columnEditable) return 'Double-click to edit'
  return hasEditGate ? 'This result column is not a direct table column' : undefined
}
