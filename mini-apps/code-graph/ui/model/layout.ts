import dagre from 'dagre'
import { EDGE_KINDS } from '../../shared/model'
import type { GraphView, ViewNode } from '../../shared/view'
import { visibleEdges } from './edges'

/**
 * Where each box of one level goes, in two stages.
 *
 * A single compound layout does not work here: dagre ranks every node globally, so the tiles of
 * one container land in different ranks and the container stretches across the whole level. So,
 * as the reference viewer does, the inside of a container is laid out first — its tiles in a
 * compact grid, which also makes its size known — and then the level's top boxes (containers,
 * plain boxes, portals) are laid out by the strongest grouped connections. Exact tile edges are
 * drawn when a box is focused.
 *
 * Pure and keyed on the level's content: selection, hover and highlight are an overlay on these
 * positions and never move a box.
 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const TILE = { width: 172, height: 30, gap: 6 }
export const GROUP = { header: 34, padX: 10, padBottom: 10, more: 20, colGap: 8, rowsPerColumn: 6 }
const LEAF = { width: 196, height: 40 }
const PORTAL = { width: 172, height: 36 }

/** Top-level boxes with their size; tiles positioned relative to their container. */
export interface Layout {
  boxes: Map<string, Box>
  /** Tile id → position inside its container. */
  tiles: Map<string, Box>
}

function tileGrid(count: number): { columns: number; rows: number } {
  const columns = count > GROUP.rowsPerColumn ? 2 : 1
  return { columns, rows: Math.ceil(count / columns) }
}

/**
 * Tiles connected to each other inside one container flow left to right along those edges, like
 * the level around them. In a column they could not: an edge leaves a tile's right side and enters
 * the next tile's left, so between two tiles stacked in one column every edge looped around the
 * outside of the container, over the tiles and the counts. Unconnected tiles keep the compact grid.
 */
function containerLayout(
  group: ViewNode,
  tiles: ViewNode[],
  inner: ReadonlyArray<[string, string]>,
) {
  if (inner.length > 0) return flowLayout(group, tiles, inner)
  const { columns, rows } = tileGrid(tiles.length)
  const positions = new Map<string, Box>()
  tiles.forEach((tile, index) => {
    const column = Math.floor(index / rows)
    const row = index % rows
    positions.set(tile.id, {
      x: GROUP.padX + column * (TILE.width + GROUP.colGap),
      y: GROUP.header + row * (TILE.height + TILE.gap),
      width: TILE.width,
      height: TILE.height,
    })
  })
  const width = GROUP.padX * 2 + columns * TILE.width + (columns - 1) * GROUP.colGap
  const more = (group.hiddenTiles ?? 0) > 0 ? GROUP.more : 0
  const height = GROUP.header + rows * (TILE.height + TILE.gap) - TILE.gap + GROUP.padBottom + more
  return { positions, width, height }
}

function flowLayout(group: ViewNode, tiles: ViewNode[], inner: ReadonlyArray<[string, string]>) {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep: 44, nodesep: TILE.gap, marginx: 0, marginy: 0 })
  for (const tile of tiles) graph.setNode(tile.id, { width: TILE.width, height: TILE.height })
  for (const [source, target] of inner) graph.setEdge(source, target)
  dagre.layout(graph)
  const positions = new Map<string, Box>()
  let right = 0
  let bottom = 0
  for (const tile of tiles) {
    const placed = graph.node(tile.id) as { x: number; y: number }
    const x = GROUP.padX + placed.x - TILE.width / 2
    const y = GROUP.header + placed.y - TILE.height / 2
    positions.set(tile.id, { x, y, width: TILE.width, height: TILE.height })
    right = Math.max(right, x + TILE.width)
    bottom = Math.max(bottom, y + TILE.height)
  }
  const more = (group.hiddenTiles ?? 0) > 0 ? GROUP.more : 0
  return { positions, width: right + GROUP.padX, height: bottom + GROUP.padBottom + more }
}

export function layoutView(view: GraphView): Layout {
  const tilesByGroup = new Map<string, ViewNode[]>()
  for (const node of view.nodes) {
    if (node.role !== 'tile' || !node.group) continue
    const list = tilesByGroup.get(node.group)
    if (list) list.push(node)
    else tilesByGroup.set(node.group, [node])
  }
  const tiles = new Map<string, Box>()
  const sizes = new Map<string, { width: number; height: number }>()
  const tileGroup = new Map(view.nodes.filter((n) => n.group).map((n) => [n.id, n.group as string]))
  const innerEdges = new Map<string, Array<[string, string]>>()
  for (const edge of view.edges) {
    const group = tileGroup.get(edge.source)
    if (!group || tileGroup.get(edge.target) !== group) continue
    const inner = innerEdges.get(group)
    if (inner) inner.push([edge.source, edge.target])
    else innerEdges.set(group, [[edge.source, edge.target]])
  }
  for (const node of view.nodes) {
    if (node.role === 'tile') continue
    const inner = tilesByGroup.get(node.id)
    if (inner && inner.length > 0) {
      const inside = containerLayout(node, inner, innerEdges.get(node.id) ?? [])
      for (const [id, box] of inside.positions) tiles.set(id, box)
      sizes.set(node.id, { width: inside.width, height: inside.height })
    } else sizes.set(node.id, node.role === 'portal' ? PORTAL : LEAF)
  }

  const groupOf = new Map(view.nodes.filter((n) => n.group).map((n) => [n.id, n.group as string]))
  const top = (id: string) => groupOf.get(id) ?? id
  const lifted = new Map<string, number>()
  const connected = new Set<string>()
  for (const edge of visibleEdges(view, new Set(EDGE_KINDS), null).edges) {
    const source = top(edge.source)
    const target = top(edge.target)
    if (source === target) continue
    const key = `${source}\u0000${target}`
    lifted.set(key, (lifted.get(key) ?? 0) + edge.count)
    connected.add(source).add(target)
  }

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep: 96, nodesep: 36, marginx: 0, marginy: 0 })
  // A fresh label per node: dagre writes the position INTO the label, and a shared size object
  // left every plain box of a level at one position, stacked on top of each other.
  for (const id of connected)
    graph.setNode(id, { ...(sizes.get(id) as { width: number; height: number }) })
  for (const [key, count] of lifted) {
    const [source, target] = key.split('\u0000') as [string, string]
    graph.setEdge(source, target, { weight: 1 + Math.log2(count + 1) })
  }
  dagre.layout(graph)

  const boxes = new Map<string, Box>()
  let bottom = 0
  let right = 0
  for (const id of connected) {
    const size = sizes.get(id) as { width: number; height: number }
    const placed = graph.node(id) as { x: number; y: number }
    const box = { x: placed.x - size.width / 2, y: placed.y - size.height / 2, ...size }
    boxes.set(id, box)
    bottom = Math.max(bottom, box.y + box.height)
    right = Math.max(right, box.x + box.width)
  }
  packLoose(
    [...sizes].filter(([id]) => !connected.has(id)),
    boxes,
    connected.size > 0 ? bottom + 72 : 0,
    Math.max(right, 880),
  )
  return { boxes, tiles }
}

/**
 * Boxes with no edge at this level, packed in rows under the connected part rather than left to
 * dagre, which stacks every disconnected node in one tall column. Containers first, then by size,
 * so the row reads from what holds the most to single files.
 */
function packLoose(
  loose: Array<[string, { width: number; height: number }]>,
  boxes: Map<string, Box>,
  top: number,
  rowWidth: number,
) {
  const gap = 28
  loose.sort(([a, x], [b, y]) => y.height - x.height || a.localeCompare(b))
  let x = 0
  let y = top
  let rowHeight = 0
  for (const [id, size] of loose) {
    if (x > 0 && x + size.width > rowWidth) {
      x = 0
      y += rowHeight + gap
      rowHeight = 0
    }
    boxes.set(id, { x, y, ...size })
    x += size.width + gap
    rowHeight = Math.max(rowHeight, size.height)
  }
}

/**
 * The identity a layout is cached on: the level's boxes and edges, not the snapshot object. Every
 * poll brings a new object with the same content, and re-running the layout on each would make
 * the view stutter every few seconds for nothing.
 */
export function layoutKey(view: GraphView): string {
  const nodes = view.nodes
    .map((node) => `${node.id}:${node.group ?? ''}:${node.hiddenTiles ?? 0}`)
    .join('|')
  const edges = view.edges.map((edge) => `${edge.source}>${edge.target}`).join('|')
  return `${view.scope.id}\u0000${nodes}\u0000${edges}`
}
