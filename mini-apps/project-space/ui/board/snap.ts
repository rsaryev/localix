import type { Box } from '../../shared/ops/geometry'

/**
 * Smart guides: where a dragged selection snaps, and the lines that show why.
 *
 * The selection's box offers its two edges and its centre on
 * each axis, every other box on the screen offers its own, and on each axis independently the
 * nearest pair within the threshold wins — 8 SCREEN pixels, so the pull feels the same at every
 * zoom. After the nudge every pair that now coincides is a guide, drawn only from the farthest
 * matched box to the selection, never across the whole board.
 */
export const SNAP_PX = 8

export interface Guide {
  axis: 'x' | 'y'
  /** The line's position on its axis: an x for a vertical guide. */
  at: number
  from: number
  to: number
}

export interface Snap {
  dx: number
  dy: number
  guides: Guide[]
}

const X = (box: Box) => [box.x, box.x + box.w / 2, box.x + box.w]
const Y = (box: Box) => [box.y, box.y + box.h / 2, box.y + box.h]

/** The smallest pull on one axis that brings a point of `mine` onto one of `theirs`. */
function nearest(mine: number[], others: readonly Box[], points: typeof X, threshold: number) {
  let best: number | null = null
  for (const other of others)
    for (const theirs of points(other))
      for (const point of mine) {
        const pull = theirs - point
        if (Math.abs(pull) <= threshold && (best === null || Math.abs(pull) < Math.abs(best)))
          best = pull
      }
  return best ?? 0
}

function guidesOn(axis: 'x' | 'y', box: Box, others: readonly Box[]): Guide[] {
  const [along, across] = axis === 'x' ? [X, Y] : [Y, X]
  const lines = new Map<number, { from: number; to: number }>()
  for (const other of others)
    for (const theirs of along(other))
      for (const point of along(box)) {
        if (Math.abs(theirs - point) > 0.5) continue
        const at = Math.round(point)
        const span = [...across(box), ...across(other)]
        const line = lines.get(at)
        lines.set(at, {
          from: Math.min(line?.from ?? Infinity, ...span),
          to: Math.max(line?.to ?? -Infinity, ...span),
        })
      }
  return [...lines].map(([at, { from, to }]) => ({ axis, at, from, to }))
}

export function snapBox(moving: Box, others: readonly Box[], threshold: number): Snap {
  const dx = nearest(X(moving), others, X, threshold)
  const dy = nearest(Y(moving), others, Y, threshold)
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy }
  return {
    dx,
    dy,
    guides: [...guidesOn('x', snapped, others), ...guidesOn('y', snapped, others)],
  }
}
