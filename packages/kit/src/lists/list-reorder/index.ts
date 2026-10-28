/**
 * REORDERING A VERTICAL LIST — the grip, the gesture, and the line that shows where a row
 * will land.
 *
 * One place, because four already existed. The workspace rail, the tab strip, the file tree
 * and a task board each wrote their own drag machine and each rediscovered the same
 * three traps (Firefox needs a `dataTransfer` payload, `dragover` must `preventDefault`, the
 * drop index is off by one when dragging downward). Those four are genuinely different —
 * they move things BETWEEN containers, across zones, into folders. This one is the simple
 * case they all contain: an ordered list of rows, reordered in place, which is what a
 * settings screen keeps needing.
 */
export { DragHandle } from './DragHandle'
export { computeDropIndex, moveItem } from './dropIndex'
export {
  useListReorder,
  type ListReorder,
  type ReorderHandleProps,
  type ReorderRowProps,
} from './useListReorder'

/**
 * The row's own classes: the hover group the handle reveals itself from, and the insertion
 * line.
 *
 * A 2px absolutely-positioned pseudo-element with `pointer-events: none` — the last part is
 * load-bearing, since an indicator that can receive pointer events generates its own
 * `dragenter` and makes the line it draws flicker. Drawn only ABOVE a row: the hook
 * normalizes "below row i" into "above row i+1", so two adjacent rows can never both show a
 * line and there is one rule here instead of two.
 */
export const REORDER_ROW_CLASS =
  'group/reorder-row relative data-dragging:opacity-40 ' +
  "data-drop-before:before:pointer-events-none data-drop-before:before:absolute data-drop-before:before:inset-x-0 data-drop-before:before:-top-px data-drop-before:before:h-0.5 data-drop-before:before:rounded-full data-drop-before:before:bg-foreground/70 data-drop-before:before:content-['']"
