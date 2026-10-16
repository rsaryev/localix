import type { EdgeKind, NodeKind } from '../../shared/model'
import type { Crumb, GraphView, NodeDetail, ViewEdge, ViewNode } from '../../shared/view'
import type { CodeGraph } from './code-graph'
import { impact, relations } from './traverse'

/**
 * One level of the map, two deep: the scope's children, and inside each child that CONTAINS code
 * (a directory; a class in a file) its own children as tiles. Portals stand for the code outside
 * the scope that the level connects to.
 *
 * Two deep because one is not enough to read: a project's top-level directories rarely depend on
 * each other directly — their files do — so a one-deep root is a column of disconnected boxes.
 * With tiles, the edges that matter (this file in `api` calls that file in `db`) are on screen, and
 * a container still shows how much it holds.
 *
 * Every edge in the project is lifted to the deepest box drawn for each end: a tile when its
 * ancestor tile is shown, else the container, else a portal — the child of the lowest common
 * ancestor, so `features/chat` importing `lib/db.ts` lands on `lib`, one click from being opened.
 * The view receives a few hundred boxes however large the project is. A directory opens to its
 * own level, so a compact parent view keeps the workbench responsive without hiding its contents.
 */
const MAX_CHILDREN = 64
const MAX_TILES = 6
const MAX_PORTALS = 16
const MAX_RELATIONS = 40
const CONTAINER_KINDS = new Set<NodeKind>(['directory', 'class', 'interface'])

export function breadcrumb(graph: CodeGraph, id: string): Crumb[] {
  return graph
    .ancestry(id)
    .reverse()
    .map((at) => {
      const node = graph.nodes.get(at)
      return { id: at, name: node?.name ?? at, ...(node ? { kind: node.kind } : {}) }
    })
}

/** The scope a node is viewed in: a directory is its own; a file too; a symbol is seen in its file. */
export function viewScopeOf(graph: CodeGraph, id: string): string {
  for (let at: string | null | undefined = id; at; at = graph.nodes.get(at)?.parent) {
    const kind = graph.nodes.get(at)?.kind
    if (kind === 'directory' || kind === 'file') return at
  }
  return id
}

/** An edge end at this level: the child of the scope it lies under, and the grandchild below that. */
interface Placement {
  child: string | null
  grandchild: string | null
  inside: boolean
}

export function graphView(
  graph: CodeGraph,
  scopeId: string,
  options: { external?: boolean } = {},
): GraphView | null {
  const scope = graph.summary(scopeId)
  if (!scope) return null
  const scopeChain = new Set(graph.ancestry(scopeId))
  const placements = new Map<string, Placement>()
  const place = (id: string): Placement => {
    const known = placements.get(id)
    if (known) return known
    let placement: Placement = { child: null, grandchild: null, inside: false }
    if (graph.nodes.get(id)?.kind === 'package') {
      placement = { child: options.external ? id : null, grandchild: null, inside: false }
    } else {
      const chain = graph.ancestry(id)
      // The first ancestor in the scope's own chain is the lowest common ancestor.
      const lca = chain.findIndex((at) => scopeChain.has(at))
      if (lca > 0) {
        const inside = chain[lca] === scopeId
        placement = {
          child: chain[lca - 1] ?? null,
          grandchild: inside && lca > 1 ? (chain[lca - 2] ?? null) : null,
          inside,
        }
      }
    }
    placements.set(id, placement)
    return placement
  }

  // Pass 1: how connected every candidate box is, to choose which children and tiles to draw.
  const weight = new Map<string, number>()
  const bump = (id: string | null, count: number) => {
    if (id) weight.set(id, (weight.get(id) ?? 0) + count)
  }
  for (const edge of graph.edges()) {
    const a = place(edge.source)
    const b = place(edge.target)
    if (!a.child || !b.child || (!a.inside && !b.inside)) continue
    if (a.child === b.child && a.grandchild === b.grandchild) continue
    bump(a.child, edge.count)
    bump(b.child, edge.count)
    bump(a.grandchild, edge.count)
    bump(b.grandchild, edge.count)
  }
  const byWeight = (x: string, y: string) =>
    (weight.get(y) ?? 0) - (weight.get(x) ?? 0) || x.localeCompare(y)

  const children = [...graph.childrenOf(scopeId)].sort(byWeight).slice(0, MAX_CHILDREN)
  const tilesOf = new Map<string, string[]>()
  for (const child of children) {
    const kind = graph.nodes.get(child)?.kind
    if (!kind || !CONTAINER_KINDS.has(kind)) continue
    tilesOf.set(child, [...graph.childrenOf(child)].sort(byWeight).slice(0, MAX_TILES))
  }
  const shownTiles = new Set([...tilesOf.values()].flat())
  const shownChildren = new Set(children)

  // Pass 2: lift every edge to the deepest box drawn for each end.
  const box = (placement: Placement): string | null => {
    if (!placement.child) return null
    if (placement.inside && !shownChildren.has(placement.child)) return null
    return placement.grandchild && shownTiles.has(placement.grandchild)
      ? placement.grandchild
      : placement.child
  }
  const aggregated = new Map<string, ViewEdge>()
  const portalWeight = new Map<string, number>()
  for (const edge of graph.edges()) {
    const a = place(edge.source)
    const b = place(edge.target)
    if (!a.inside && !b.inside) continue
    const source = box(a)
    const target = box(b)
    // An edge into a box's own container (a file-level call into its class's method) is internal.
    if (!source || !target || source === target || source === b.child || target === a.child)
      continue
    const key = `${source}\u0000${target}`
    let entry = aggregated.get(key)
    if (!entry) {
      entry = { source, target, count: 0, kinds: {} }
      aggregated.set(key, entry)
    }
    entry.count += edge.count
    entry.kinds[edge.kind] = (entry.kinds[edge.kind] ?? 0) + edge.count
    if (!a.inside) portalWeight.set(source, (portalWeight.get(source) ?? 0) + edge.count)
    if (!b.inside) portalWeight.set(target, (portalWeight.get(target) ?? 0) + edge.count)
  }
  const portals = [...portalWeight.keys()]
    .sort((x, y) => (portalWeight.get(y) ?? 0) - (portalWeight.get(x) ?? 0) || x.localeCompare(y))
    .slice(0, MAX_PORTALS)

  const nodes: ViewNode[] = []
  for (const id of [...children].sort()) {
    const summary = graph.summary(id)
    if (!summary) continue
    const tiles = tilesOf.get(id)
    nodes.push({
      ...summary,
      role: 'child',
      ...(tiles && tiles.length > 0
        ? { hiddenTiles: graph.childrenOf(id).length - tiles.length }
        : {}),
    })
    for (const tile of [...(tiles ?? [])].sort()) {
      const tileSummary = graph.summary(tile)
      if (tileSummary) nodes.push({ ...tileSummary, role: 'tile', group: id })
    }
  }
  for (const id of portals) {
    const summary = graph.summary(id)
    if (summary) nodes.push({ ...summary, role: 'portal' })
  }
  const drawn = new Set(nodes.map((node) => node.id))
  const edges = [...aggregated.values()].filter((e) => drawn.has(e.source) && drawn.has(e.target))
  for (const edge of edges) {
    if (aggregated.has(`${edge.target}\u0000${edge.source}`)) edge.cyclic = true
  }
  return {
    scope,
    breadcrumb: breadcrumb(graph, scopeId),
    nodes,
    edges,
    truncated: Math.max(0, graph.childrenOf(scopeId).length - children.length),
  }
}

export function nodeDetail(graph: CodeGraph, id: string): NodeDetail | null {
  const node = graph.summary(id)
  if (!node) return null
  const { incoming, outgoing } = relations(graph, id)
  return {
    node,
    breadcrumb: breadcrumb(graph, id),
    incoming: incoming.slice(0, MAX_RELATIONS),
    outgoing: outgoing.slice(0, MAX_RELATIONS),
    moreIncoming: Math.max(0, incoming.length - MAX_RELATIONS),
    moreOutgoing: Math.max(0, outgoing.length - MAX_RELATIONS),
    impactFiles:
      node.kind === 'package' || node.kind === 'directory' ? 0 : impact(graph, id).length,
  }
}

export const EDGE_KIND_LABEL: Record<EdgeKind, { out: string; in: string }> = {
  imports: { out: 'imports', in: 'imported by' },
  calls: { out: 'calls', in: 'called by' },
  extends: { out: 'extends', in: 'extended by' },
  implements: { out: 'implements', in: 'implemented by' },
}
