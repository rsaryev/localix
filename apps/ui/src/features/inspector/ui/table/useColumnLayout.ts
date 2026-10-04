import { useRef, useState } from 'react'
import type { TableColumn } from '@localixai/dataview'

/** Minimum rendered width of a data column, and the floor a drag-resize clamps to. */
export const COL_MIN = 132
const KEYBOARD_STEP = 16

/**
 * The grid's column-layout model: it turns the column list plus any user resizes into
 * the ONE CSS-grid template that the header, the body rows, the draft row and the
 * staged-insert rows all share (which is what keeps them aligned through horizontal
 * scroll — every consumer must use the identical template, so it is derived once here).
 *
 * The track algebra is the knowledge this owns:
 *  - An UNRESIZED column is `minmax(COL_MIN, 1fr)` — it fills leftover width, and the
 *    COL_MIN floor is what forces the parent to scroll horizontally when the columns
 *    no longer fit.
 *  - A RESIZED column becomes a FIXED px track, so the remaining `1fr` columns reflow
 *    around it instead of fighting it.
 *  - The row-number gutter leads the template and is sized to the widest index it will
 *    ever have to show.
 *
 * Resizing tracks the pointer on `window` (not the cell) so a fast drag that leaves the
 * header still resizes; the listeners are removed on release.
 *
 * DURING a drag the template is written straight to a CSS custom property on the grid root, and
 * state is committed once on release. The template is shared by the header, every virtualized row,
 * the draft row and the staged rows, so setting it in state per `mousemove` re-rendered all of them
 * for every pixel of pointer travel — dozens of times a second, to produce a value the browser was
 * going to recompute from CSS anyway. The variable is the same one track the consumers read, so
 * nothing goes out of sync: the drag moves it, the release records where it stopped.
 */
/** The custom property every grid consumer reads its column template from. */
export const GRID_TEMPLATE_VAR = '--table-grid-template'

export function useColumnLayout(columns: TableColumn[], rowCount: number, total: number) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  /** The grid root that carries the template variable. Attached by the consumer. */
  const rootRef = useRef<HTMLDivElement | null>(null)

  const gutterWidth = Math.max(40, String(Math.max(rowCount, total)).length * 8 + 20)
  const gridTemplate = buildTemplate(columns, widths, gutterWidth)

  // Freezes the column's current RENDERED width on grab (a `1fr` column has no explicit
  // width until then), so the drag starts from where the column visually is.
  const dragRef = useRef<{ id: string; startX: number; startW: number; width: number } | null>(null)
  const startResize = (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const headerCell = (e.currentTarget as HTMLElement).parentElement
    const startW = widths[id] ?? headerCell?.getBoundingClientRect().width ?? COL_MIN
    dragRef.current = { id, startX: e.clientX, startW, width: startW }
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      d.width = Math.max(COL_MIN, Math.round(d.startW + (ev.clientX - d.startX)))
      rootRef.current?.style.setProperty(
        GRID_TEMPLATE_VAR,
        buildTemplate(columns, { ...widths, [d.id]: d.width }, gutterWidth),
      )
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // One state write, at the end: the pixels already moved, this is what remembers them.
      if (d) setWidths((w) => ({ ...w, [d.id]: d.width }))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** Drop a column's fixed width, returning it to the `1fr` fill pool. */
  const resetWidth = (id: string) =>
    setWidths((w) => {
      const { [id]: _drop, ...rest } = w
      return rest
    })

  const resizeWithKeyboard = (id: string, e: React.KeyboardEvent) => {
    const rendered = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().width
    const current = widths[id] ?? rendered ?? COL_MIN
    const step = e.shiftKey ? KEYBOARD_STEP * 4 : KEYBOARD_STEP
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      resetWidth(id)
      return
    }
    let next: number
    if (e.key === 'ArrowRight') next = current + step
    else if (e.key === 'ArrowLeft') next = current - step
    else if (e.key === 'Home') next = COL_MIN
    else return
    e.preventDefault()
    setWidths((value) => ({ ...value, [id]: Math.max(COL_MIN, Math.round(next)) }))
  }

  return { gridTemplate, widths, rootRef, startResize, resizeWithKeyboard, resetWidth }
}

/** The one CSS-grid template the header and every row share. Pure, so a drag can call it directly. */
function buildTemplate(
  columns: readonly TableColumn[],
  widths: Record<string, number>,
  gutterWidth: number,
): string {
  const colTracks = columns
    .map((c) => (widths[c.id] ? `${widths[c.id]}px` : `minmax(${COL_MIN}px, 1fr)`))
    .join(' ')
  return `${gutterWidth}px ${colTracks}`
}
