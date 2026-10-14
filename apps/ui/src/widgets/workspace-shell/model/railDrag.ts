/**
 * Pure state-machine transitions for the customizable rail's visible-zone drag.
 *
 * The rail's visible zones are drag-reorderable, and entries move between them the
 * same way. This module holds the transient drag state + the pure transitions,
 * with ZERO React/DOM so the reducer can be unit-tested. Every transition either
 * returns a NEW state or the SAME reference when nothing changed (so a functional
 * `setState` can bail out of a render). The DOM-facing wiring (event guards,
 * `getBoundingClientRect`, the `computeDropIndex`/`moveRailItem` calls) lives in
 * the `useRailDnd` hook.
 */

/** Transient drag state for the customizable middle zone. */
export interface RailDrag {
  /** id of the entry being dragged, or null when idle. */
  dragId: string | null
  /** Current bar drop target (the dragged entry lands before/after it). */
  target: { id: string; after: boolean } | null
  /** Visible rail area currently under the pointer. */
  overZone: 'top' | 'bar' | 'bottom' | 'status' | null
}

/** Native payload marker shared by every rail drag source. */
export const RAIL_ENTRY_DRAG_MIME = 'application/x-localix-rail-entry'

export const IDLE_DRAG: RailDrag = { dragId: null, target: null, overZone: null }

/** Start dragging `id` — clears any prior drop target. */
export function beginDrag(id: string): RailDrag {
  return { dragId: id, target: null, overZone: null }
}

/**
 * Pointer moved over bar entry `id` (`after` = past its vertical midpoint). Returns
 * the SAME state when the target is already there (so an unchanged hover doesn't
 * re-render); clears any overflow hover otherwise.
 */
export function hoverItem(
  prev: RailDrag,
  id: string,
  after: boolean,
  area: 'top' | 'bar' | 'bottom' | 'status' = 'bar',
): RailDrag {
  return prev.target?.id === id && prev.target.after === after && prev.overZone === area
    ? prev
    : { ...prev, target: { id, after }, overZone: area }
}

/** Pointer is inside the rail's dead space; optionally clear a stale item target. */
export function hoverZone(
  prev: RailDrag,
  clearTarget: boolean,
  area: 'top' | 'bar' | 'bottom' | 'status' = 'bar',
): RailDrag {
  const target = clearTarget ? null : prev.target
  return prev.overZone === area && target === prev.target
    ? prev
    : { ...prev, target, overZone: area }
}

/** Pointer left the whole rail zone — clear its surface and insertion feedback. */
export function leaveZone(
  prev: RailDrag,
  area: 'top' | 'bar' | 'bottom' | 'status' = 'bar',
): RailDrag {
  return prev.overZone !== area ? prev : { ...prev, target: null, overZone: null }
}
