import dagre from 'dagre'
import type { FlowContent, FlowEdge } from './flow-text'
import { endsOf, loopRoute, vertical } from './flow-ends'
import { anchor, FLOW, linesOf, sizeOf, type FlowBox } from './flow-nodes'
import { orthogonalRoute, roundedPath, type Point, type Side } from './flow-route'

export { FLOW, nameLines, type FlowBox } from './flow-nodes'

/**
 * Where everything of a flowchart goes: one answer, read by the view that draws it and by
 * `measure`, which sizes the element — so the element is exactly as large as what it draws.
 *
 * Ranks and order come from dagre (the layered layout the code graph and the database diagram
 * already use); the lines are the board's own. Every connector runs at right angles with rounded
 * corners, leaves and enters a box square to its side, and several connectors on one side each get
 * their own point along it — a diagonal or two lines sharing one point is where a diagram stops
 * being readable.
 *
 * Text is measured by estimate (a character is about `char` pixels) because the layout also runs
 * on the server, where there is no font to measure with.
 */
export type FlowSpacing = keyof typeof FLOW.spacing

export interface LaidNode extends FlowBox {
  /** The first line is the name, the rest are sublabels. */
  lines: string[]
}
export interface LaidEdge {
  edge: FlowEdge
  /** The sides it leaves and enters by: kept when the chart is taken apart into shapes. */
  sides: [Side, Side]
  path: string
  /** Where each arrowhead points: its tip and the direction it travels. */
  heads: { tip: Point; toward: Point }[]
  label?: { x: number; y: number; across: boolean; w: number }
}
export interface FlowLayout {
  width: number
  height: number
  nodes: Map<string, LaidNode>
  edges: LaidEdge[]
  groups: (FlowBox & { id: string; label: string })[]
}

export function layoutFlow(content: FlowContent, spacing: FlowSpacing = 'regular'): FlowLayout {
  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true })
  const gaps = FLOW.spacing[spacing]
  graph.setGraph({
    rankdir: content.direction,
    nodesep: gaps.node,
    ranksep: gaps.rank,
    edgesep: 16,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  const known = new Set(content.nodes.map((node) => node.id))
  const groups = new Set(content.groups.map((group) => group.id))
  for (const group of content.groups) graph.setNode(`group:${group.id}`, {})
  const lines = new Map(content.nodes.map((node) => [node.id, linesOf(node)]))
  for (const node of content.nodes) {
    const size = sizeOf(node, lines.get(node.id)!)
    graph.setNode(node.id, { width: size.w, height: size.h })
    if (node.group && groups.has(node.group)) graph.setParent(node.id, `group:${node.group}`)
  }
  content.edges.forEach((edge, index) => {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) return
    // A labelled edge is given the room its label needs between the ranks.
    const label = edge.label ? { width: edge.label.length * FLOW.char.label + 16, height: 20 } : {}
    graph.setEdge(edge.from, edge.to, label, String(index))
  })
  dagre.layout(graph)

  const boxes = new Map<string, FlowBox>()
  for (const node of content.nodes) {
    const laid = graph.node(node.id)
    boxes.set(node.id, {
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      w: laid.width,
      h: laid.height,
    })
  }
  const down = vertical(content.direction)

  // Which side each end takes, then each side's ends spread along it in the order of the far end.
  const nodeOf = new Map(content.nodes.map((node) => [node.id, node]))
  const ends = content.edges.map((edge) => {
    const from = boxes.get(edge.from)
    const to = boxes.get(edge.to)
    const decision = nodeOf.get(edge.from)?.shape === 'diamond'
    return from && to && edge.from !== edge.to
      ? endsOf(from, to, content.direction, decision)
      : null
  })
  const slots = new Map<string, { index: number; end: 0 | 1; key: number }[]>()
  content.edges.forEach((edge, index) => {
    const sides = ends[index]?.sides
    if (!sides) return
    ;([0, 1] as const).forEach((end) => {
      const self = end === 0 ? edge.from : edge.to
      const other = boxes.get(end === 0 ? edge.to : edge.from)!
      const side = sides[end]
      const key =
        side === 'top' || side === 'bottom' ? other.x + other.w / 2 : other.y + other.h / 2
      const list = slots.get(`${self}:${side}`) ?? []
      list.push({ index, end, key })
      slots.set(`${self}:${side}`, list)
    })
  })
  const offsets = new Map<string, number>()
  for (const list of slots.values())
    [...list]
      .sort((a, b) => a.key - b.key)
      .forEach((slot, k) =>
        offsets.set(`${slot.index}:${slot.end}`, (k + 1) / (list.length + 1) - 0.5),
      )

  const edges: LaidEdge[] = []
  const reach: Point[] = []
  let loops = 0
  content.edges.forEach((edge, index) => {
    const found = ends[index]
    if (!found) return
    const { sides } = found
    const laid = graph.edge(edge.from, edge.to, String(index)) as { points?: Point[] } | undefined
    const start = anchor(
      nodeOf.get(edge.from)!,
      boxes.get(edge.from)!,
      sides[0],
      offsets.get(`${index}:0`) ?? 0,
    )
    const end = anchor(
      nodeOf.get(edge.to)!,
      boxes.get(edge.to)!,
      sides[1],
      offsets.get(`${index}:1`) ?? 0,
    )
    const inner = (laid?.points ?? []).slice(1, -1)
    const route = found.loop
      ? loopRoute(start, end, boxes.values(), down, loops++)
      : orthogonalRoute([start, ...inner, end], sides, down)
    reach.push(...route)
    edges.push({
      edge,
      sides,
      ...roundedPath(route, edge.head, FLOW.arrow),
      label: labelOf(edge, route),
    })
  })

  const laidGroups = content.groups.flatMap((group) => {
    const laid = graph.node(`group:${group.id}`)
    if (!laid?.width) return []
    const { pad, title } = FLOW.group
    return [
      {
        id: group.id,
        label: group.label,
        x: laid.x - laid.width / 2 - pad,
        y: laid.y - laid.height / 2 - pad - title,
        w: laid.width + pad * 2,
        h: laid.height + pad * 2 + title,
      },
    ]
  })
  return place(content, boxes, lines, edges, laidGroups, reach)
}

/** A label beside the longest straight run of its line: above it across, to its right down. */
function labelOf(edge: FlowEdge, route: Point[]): LaidEdge['label'] {
  if (!edge.label) return undefined
  let best = { length: -1, a: route[0]!, b: route[0]! }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > best.length) best = { length, a, b }
  }
  return {
    x: (best.a.x + best.b.x) / 2,
    y: (best.a.y + best.b.y) / 2,
    across: Math.abs(best.b.x - best.a.x) >= Math.abs(best.b.y - best.a.y),
    w: edge.label.length * FLOW.char.label + 12,
  }
}

/** Everything moved so the drawing starts at the padding under the card's header. */
function place(
  content: FlowContent,
  boxes: Map<string, FlowBox>,
  lines: Map<string, string[]>,
  edges: LaidEdge[],
  groups: FlowLayout['groups'],
  reach: readonly Point[],
): FlowLayout {
  // Lines count too: a loop runs outside every box, and the element must hold it.
  const xs: number[] = reach.map((point) => point.x)
  const ys: number[] = reach.map((point) => point.y)
  const take = (box: FlowBox) => {
    xs.push(box.x, box.x + box.w)
    ys.push(box.y, box.y + box.h)
  }
  for (const box of boxes.values()) take(box)
  for (const group of groups) take(group)
  for (const edge of edges)
    if (edge.label) {
      const { x, y, w, across } = edge.label
      take(across ? { x: x - w / 2, y: y - 26, w, h: 26 } : { x, y: y - 10, w: w + 10, h: 20 })
    }
  // A chart with no steps yet is an empty card the size of one step, not -Infinity wide.
  if (xs.length === 0)
    return {
      width: FLOW.node.min + FLOW.pad * 2,
      height: FLOW.header + FLOW.pad * 2 + 44,
      nodes: new Map(),
      edges: [],
      groups: [],
    }
  const dx = FLOW.pad - Math.min(...xs)
  const dy = FLOW.header + FLOW.pad - Math.min(...ys)
  const shift = (point: Point) => ({ x: point.x + dx, y: point.y + dy })
  const nodes = new Map<string, LaidNode>()
  for (const node of content.nodes) {
    const box = boxes.get(node.id)!
    nodes.set(node.id, {
      x: box.x + dx,
      y: box.y + dy,
      w: box.w,
      h: box.h,
      lines: lines.get(node.id)!,
    })
  }
  return {
    width: Math.ceil(Math.max(...xs) + dx + FLOW.pad),
    height: Math.ceil(Math.max(...ys) + dy + FLOW.pad),
    nodes,
    groups: groups.map((group) => ({ ...group, x: group.x + dx, y: group.y + dy })),
    edges: edges.map((edge) => ({
      ...edge,
      path: translatePath(edge.path, dx, dy),
      heads: edge.heads.map((head) => ({ tip: shift(head.tip), toward: head.toward })),
      label: edge.label && { ...edge.label, x: edge.label.x + dx, y: edge.label.y + dy },
    })),
  }
}

/** A path of absolute commands moved by (dx, dy); its numbers come in x y pairs. */
const translatePath = (path: string, dx: number, dy: number) => {
  let index = 0
  return path.replace(/-?\d+(?:\.\d+)?/gu, (number) =>
    String(Math.round((Number(number) + (index++ % 2 === 0 ? dx : dy)) * 10) / 10),
  )
}
