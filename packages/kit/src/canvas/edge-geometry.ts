/**
 * An arrowhead drawn as part of its edge, for a target on any side.
 *
 * A marker (`markerEnd`) cannot be themed: it does not inherit the colour of the line that
 * references it, and its colour attribute does not resolve `var()` — the database diagram's
 * arrows came out black on a dark theme while their lines were tinted. So the head is a path in
 * the edge's own group, painted with `currentColor`, and the line stops where the head begins so
 * the tip sits flush against the node.
 */
import type { CanvasPoint } from './camera'

export type HandleSide = 'left' | 'right' | 'top' | 'bottom'

/** The direction an edge travels as it ENTERS a node through a handle on `side`. */
const INTO: Record<HandleSide, CanvasPoint> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
}

export interface ArrowHead {
  /** Where the line should end so the head closes it. */
  lineEnd: CanvasPoint
  /** The filled head, tip at the handle. */
  path: string
}

export function arrowHead(tip: CanvasPoint, side: HandleSide, size: number): ArrowHead {
  const into = INTO[side]
  const across = { x: -into.y, y: into.x }
  const base = { x: tip.x - into.x * (size + 1), y: tip.y - into.y * (size + 1) }
  const half = size * 0.7
  const a = { x: base.x + across.x * half, y: base.y + across.y * half }
  const b = { x: base.x - across.x * half, y: base.y - across.y * half }
  return {
    lineEnd: { x: tip.x - into.x * size, y: tip.y - into.y * size },
    path: `M ${a.x} ${a.y} L ${tip.x} ${tip.y} L ${b.x} ${b.y} Z`,
  }
}

/**
 * The ends of a FLOATING edge: each attaches to the middle of the side of its node that faces the
 * other node, so a connector follows the nodes as they move instead of looping back to a handle
 * fixed on the far side. The facing side is
 * the one the centre-to-centre line leaves through, measured against each node's own proportions
 * so a wide card and a tall one both choose the side a person would. A pinned side wins.
 */
export interface FloatingEnds {
  source: CanvasPoint & { side: HandleSide }
  target: CanvasPoint & { side: HandleSide }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function floatingEnds(
  source: Rect,
  target: Rect,
  pinned: { source?: HandleSide; target?: HandleSide } = {},
): FloatingEnds {
  const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const from = centre(source)
  const to = centre(target)
  const facing = (rect: Rect, towards: CanvasPoint, own: CanvasPoint): HandleSide => {
    const dx = (towards.x - own.x) / Math.max(1, rect.width)
    const dy = (towards.y - own.y) / Math.max(1, rect.height)
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
    return dy >= 0 ? 'bottom' : 'top'
  }
  const at = (rect: Rect, side: HandleSide) => {
    const mid = centre(rect)
    if (side === 'left') return { x: rect.x, y: mid.y, side }
    if (side === 'right') return { x: rect.x + rect.width, y: mid.y, side }
    if (side === 'top') return { x: mid.x, y: rect.y, side }
    return { x: mid.x, y: rect.y + rect.height, side }
  }
  return {
    source: at(source, pinned.source ?? facing(source, to, from)),
    target: at(target, pinned.target ?? facing(target, from, to)),
  }
}

/** Stroke width for an edge standing for `count` relations: grows slowly, then stops. */
export function edgeWeight(count: number): number {
  return Math.min(1 + Math.log2(Math.max(0, count) + 1) * 0.4, 3.5)
}
