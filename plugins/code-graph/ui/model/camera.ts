import {
  boundsOf,
  midpoint,
  readableViewport,
  type CameraViewport,
  type CanvasPoint,
  type CanvasSize,
} from '@localixai/kit/canvas'
import { EDGE_KINDS } from '../../shared/model'
import type { GraphView } from '../../shared/view'
import { visibleEdges } from './edges'
import type { Layout } from './layout'

/**
 * Where a level opens. The board's rule (`readableViewport`): fitted while a fit stays readable,
 * otherwise at reading scale. What is the map's own is WHERE a too-large level opens — on the box
 * the person just came out of, else on the level's centre of gravity: the midpoint of its
 * connections, weighted by how many relations each carries, so the camera lands where the code
 * talks to itself rather than in the empty middle of a wide row of folders.
 */
export function openingViewport(
  view: GraphView,
  layout: Layout,
  size: CanvasSize,
  revealId?: string,
): CameraViewport {
  const bounds = boundsOf(layout.boxes.values())
  if (!bounds || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 }
  const reveal = revealId ? layout.boxes.get(revealId) : undefined
  const anchor = reveal ? midpoint(reveal) : connectedCenter(view, layout, midpoint(bounds))
  return readableViewport(bounds, size, { anchor })
}

function connectedCenter(view: GraphView, layout: Layout, fallback: CanvasPoint): CanvasPoint {
  const edges = visibleEdges(view, new Set(EDGE_KINDS), null).edges
  let x = 0
  let y = 0
  let weight = 0
  for (const edge of edges) {
    const source = layout.boxes.get(edge.source)
    const target = layout.boxes.get(edge.target)
    if (!source || !target) continue
    const a = midpoint(source)
    const b = midpoint(target)
    const strength = Math.min(5, 1 + Math.log2(edge.count + 1))
    x += ((a.x + b.x) / 2) * strength
    y += ((a.y + b.y) / 2) * strength
    weight += strength
  }
  return weight > 0 ? { x: x / weight, y: y / weight } : fallback
}
