import type { CanvasPoint } from './camera'
import { arrowHead, type HandleSide } from './edge-geometry'

/**
 * The end of a line: none, an open arrow, a filled triangle, a dot, a diamond or a bar — the set
 * every diagramming board offers, minus the ERD crow's-feet a whiteboard rarely needs.
 *
 * Each cap is drawn as a path in the edge's own group (`edge-geometry.ts` says why a marker cannot
 * be), and says where the LINE must stop so the cap closes it: a filled cap sits in front of the
 * line's end, an open arrow and a bar sit on it.
 */
export const EDGE_CAPS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const
export type EdgeCap = (typeof EDGE_CAPS)[number]

export interface CapShape {
  lineEnd: CanvasPoint
  path: string
  /** Filled caps paint with the line's colour; open ones stroke with it. */
  filled: boolean
}

const INTO: Record<HandleSide, CanvasPoint> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
}

export function edgeCap(
  kind: EdgeCap,
  tip: CanvasPoint,
  side: HandleSide,
  size: number,
): CapShape | null {
  const into = INTO[side]
  const across = { x: -into.y, y: into.x }
  const back = (distance: number) => ({
    x: tip.x - into.x * distance,
    y: tip.y - into.y * distance,
  })
  const aside = (from: CanvasPoint, distance: number) => ({
    x: from.x + across.x * distance,
    y: from.y + across.y * distance,
  })
  const at = (point: CanvasPoint) => `${round(point.x)} ${round(point.y)}`

  switch (kind) {
    case 'none':
      return null
    case 'triangle': {
      const head = arrowHead(tip, side, size)
      return { ...head, filled: true }
    }
    case 'arrow': {
      const base = back(size * 1.4)
      return {
        lineEnd: tip,
        path: `M ${at(aside(base, size))} L ${at(tip)} L ${at(aside(base, -size))}`,
        filled: false,
      }
    }
    case 'circle': {
      const r = size * 0.7
      const centre = back(r)
      return {
        lineEnd: back(r * 2),
        path: `M ${at(aside(centre, r))} A ${r} ${r} 0 1 0 ${at(aside(centre, -r))} A ${r} ${r} 0 1 0 ${at(aside(centre, r))} Z`,
        filled: true,
      }
    }
    case 'diamond': {
      const middle = back(size)
      return {
        lineEnd: back(size * 2),
        path: `M ${at(tip)} L ${at(aside(middle, size * 0.7))} L ${at(back(size * 2))} L ${at(aside(middle, -size * 0.7))} Z`,
        filled: true,
      }
    }
    case 'bar':
      return {
        lineEnd: tip,
        path: `M ${at(aside(tip, size))} L ${at(aside(tip, -size))}`,
        filled: false,
      }
  }
}

const round = (value: number) => Math.round(value * 100) / 100
