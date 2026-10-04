import { edgeWeight, type CanvasEdgeType, type Node } from '@localixai/kit/canvas'
import type { EdgeKind } from '../../shared/model'
import type { GraphView, ViewNode } from '../../shared/view'
import { visibleEdges } from './edges'
import type { Layout } from './layout'
export { countOf } from './edges'

/**
 * One level as React Flow nodes and edges: the memoised layout plus an overlay of what is in
 * FOCUS (hovered, else selected), highlighted by the agent and filtered by kind. The overlay is
 * O(n) and runs on every hover; the layout never does.
 *
 * Focus follows the reference viewer's rule: the focused box and its direct connections stay
 * lit, everything else recedes. A container counts as focused when any of its tiles is.
 */
export type NodeEmphasis = 'focus' | 'neighbor' | 'idle' | 'dimmed'

export interface GraphNodeData extends Record<string, unknown> {
  node: ViewNode
  emphasis: NodeEmphasis
  /** The agent pointed at it with `code_graph_show`. */
  highlighted: boolean
}

export interface Overlay {
  focus: string | null
  highlighted: ReadonlySet<string>
  kinds: ReadonlySet<EdgeKind>
}

export const GROUP_TYPE = 'code-graph-group'
export const BOX_TYPE = 'code-graph-box'

export function toFlow(
  view: GraphView,
  layout: Layout,
  overlay: Overlay,
): {
  nodes: Node<GraphNodeData>[]
  edges: CanvasEdgeType[]
  totalConnections: number
  focused: boolean
} {
  // A refresh can delete the selected node while the view still remembers its id. Treat that as
  // overview until the next deliberate selection, rather than showing a blank map.
  const focus =
    overlay.focus && view.nodes.some((node) => node.id === overlay.focus) ? overlay.focus : null
  const drawing = visibleEdges(view, overlay.kinds, focus)

  const tilesOf = new Map<string, string[]>()
  for (const node of view.nodes) {
    if (node.group) tilesOf.set(node.group, [...(tilesOf.get(node.group) ?? []), node.id])
  }
  const focused = new Set<string>()
  if (focus) {
    focused.add(focus)
    for (const tile of tilesOf.get(focus) ?? []) focused.add(tile)
  }
  const neighbors = new Set<string>()
  for (const edge of drawing.edges) {
    if (focused.has(edge.source)) neighbors.add(edge.target)
    if (focused.has(edge.target)) neighbors.add(edge.source)
  }
  const active = focused.size > 0
  const emphasisOf = (node: ViewNode): NodeEmphasis => {
    if (!active) return 'idle'
    if (node.id === focus) return 'focus'
    if (focused.has(node.id) || neighbors.has(node.id)) return 'neighbor'
    // A container stays legible while one of its tiles is involved.
    const tiles = tilesOf.get(node.id)
    if (tiles?.some((tile) => focused.has(tile) || neighbors.has(tile))) return 'idle'
    return 'dimmed'
  }

  const nodes: Node<GraphNodeData>[] = []
  const data = (node: ViewNode): GraphNodeData => ({
    node,
    emphasis: emphasisOf(node),
    highlighted: overlay.highlighted.has(node.id),
  })
  // Containers first: React Flow requires a parent to precede its children.
  for (const node of view.nodes) {
    const box = layout.boxes.get(node.id)
    if (node.role === 'tile' || !box) continue
    nodes.push({
      id: node.id,
      type: tilesOf.has(node.id) ? GROUP_TYPE : BOX_TYPE,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: data(node),
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: 2,
    })
  }
  for (const node of view.nodes) {
    const box = layout.tiles.get(node.id)
    if (node.role !== 'tile' || !box || !node.group || !layout.boxes.has(node.group)) continue
    nodes.push({
      id: node.id,
      type: BOX_TYPE,
      parentId: node.group,
      extent: 'parent',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: data(node),
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: 3,
    })
  }

  // A line's width is how many relations it stands for; a cycle is the warning tone at rest; the
  // arrow and the count appear only on the connections being traced, so the overview stays calm.
  const edges: CanvasEdgeType[] = drawing.edges.map((edge) => {
    const touching = focused.has(edge.source) || focused.has(edge.target)
    return {
      id: `${edge.source}\u0000${edge.target}`,
      source: edge.source,
      target: edge.target,
      focusable: false,
      selectable: false,
      data: {
        emphasis: touching ? 'focus' : active ? 'dimmed' : 'idle',
        tone: edge.cyclic === true ? 'warning' : 'neutral',
        weight: edgeWeight(edge.count),
        arrow: 'focus',
        ...(edge.count > 1 ? { label: String(edge.count) } : {}),
      },
      zIndex: 0,
    }
  })
  return { nodes, edges, totalConnections: drawing.total, focused: active }
}
